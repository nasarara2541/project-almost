import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { hashToken, seal, unseal } from "@/lib/auth/crypto";
import {
  createAuthSession,
  deleteAuthSession,
  getAuthSession,
  updateAuthSessionTokens,
  upsertGithubUser,
  type ProductUser,
} from "@/lib/product/store";

export const SESSION_COOKIE = "repolens_session";
export const OAUTH_COOKIE = "repolens_oauth";

type GithubUserResponse = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
};

export type GithubTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};

export type CurrentAuth = {
  user: ProductUser;
  accessToken: string;
  sessionToken: string;
};

export function githubAuthConfigured() {
  return Boolean(
    process.env.GITHUB_APP_CLIENT_ID?.trim()
    && process.env.GITHUB_APP_CLIENT_SECRET?.trim()
    && process.env.AUTH_SECRET?.trim(),
  );
}

function expiryFromNow(seconds: number | undefined) {
  return seconds ? new Date(Date.now() + seconds * 1_000).toISOString() : null;
}

async function refreshAccessToken(session: Awaited<ReturnType<typeof getAuthSession>>) {
  if (!session?.refreshToken) return session;
  if (session.refreshExpiresAt && new Date(session.refreshExpiresAt).getTime() <= Date.now()) return null;
  const refreshToken = unseal(session.refreshToken);
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GITHUB_APP_CLIENT_ID ?? "",
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const body = await response.json() as GithubTokenResponse;
  if (!response.ok || !body.access_token) return null;
  await updateAuthSessionTokens({
    tokenHash: session.tokenHash,
    accessToken: seal(body.access_token),
    refreshToken: body.refresh_token ? seal(body.refresh_token) : session.refreshToken,
    accessExpiresAt: expiryFromNow(body.expires_in),
    refreshExpiresAt: expiryFromNow(body.refresh_token_expires_in) ?? session.refreshExpiresAt,
  });
  return getAuthSession(session.tokenHash);
}

export async function createGithubSession(tokens: GithubTokenResponse) {
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokens.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "RepoLens",
    },
    cache: "no-store",
  });
  if (!userResponse.ok) throw new Error("GitHub user profile could not be loaded.");
  const githubUser = await userResponse.json() as GithubUserResponse;
  const user = await upsertGithubUser({
    githubId: githubUser.id,
    login: githubUser.login,
    name: githubUser.name ?? null,
    avatarUrl: githubUser.avatar_url ?? null,
  });
  const sessionToken = randomBytes(32).toString("base64url");
  await createAuthSession({
    tokenHash: hashToken(sessionToken),
    userId: user.id,
    accessToken: seal(tokens.access_token),
    refreshToken: tokens.refresh_token ? seal(tokens.refresh_token) : null,
    accessExpiresAt: expiryFromNow(tokens.expires_in),
    refreshExpiresAt: expiryFromNow(tokens.refresh_token_expires_in),
  });
  return { sessionToken, user };
}

export async function currentAuth(): Promise<CurrentAuth | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) return null;
  let session = await getAuthSession(hashToken(sessionToken));
  if (!session) return null;
  try {
    if (session.accessExpiresAt && new Date(session.accessExpiresAt).getTime() < Date.now() + 60_000) {
      session = await refreshAccessToken(session);
    }
  } catch {
    return null;
  }
  if (!session) return null;
  try {
    return { user: session.user, accessToken: unseal(session.accessToken), sessionToken };
  } catch {
    await deleteAuthSession(session.tokenHash);
    return null;
  }
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionToken) await deleteAuthSession(hashToken(sessionToken));
}
