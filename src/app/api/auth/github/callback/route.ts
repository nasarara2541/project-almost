import { NextRequest, NextResponse } from "next/server";
import { unseal } from "@/lib/auth/crypto";
import {
  createGithubSession,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  type GithubTokenResponse,
} from "@/lib/auth/session";

export const runtime = "nodejs";

type OAuthState = { state: string; verifier: string; returnTo: string; createdAt: number };

function errorRedirect(request: NextRequest, message: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("auth_error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    const returnedState = request.nextUrl.searchParams.get("state");
    const stateCookie = request.cookies.get(OAUTH_COOKIE)?.value;
    if (!code || !returnedState || !stateCookie) return errorRedirect(request, "GitHub authorization was incomplete.");
    const saved = JSON.parse(unseal(stateCookie)) as OAuthState;
    if (saved.state !== returnedState || Date.now() - saved.createdAt > 10 * 60 * 1_000) {
      return errorRedirect(request, "GitHub authorization expired. Please try again.");
    }
    const callback = new URL("/api/auth/github/callback", request.url).toString();
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GITHUB_APP_CLIENT_ID ?? "",
        client_secret: process.env.GITHUB_APP_CLIENT_SECRET ?? "",
        code,
        redirect_uri: callback,
        code_verifier: saved.verifier,
      }),
      cache: "no-store",
    });
    const tokens = await tokenResponse.json() as GithubTokenResponse;
    if (!tokenResponse.ok || !tokens.access_token) {
      return errorRedirect(request, tokens.error_description ?? "GitHub authorization failed.");
    }
    const { sessionToken } = await createGithubSession(tokens);
    const response = NextResponse.redirect(new URL(saved.returnTo || "/", request.url));
    response.cookies.delete(OAUTH_COOKIE);
    response.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    console.error("GitHub OAuth callback failed:", error);
    return errorRedirect(request, "GitHub authorization could not be completed.");
  }
}
