import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { seal } from "@/lib/auth/crypto";
import { githubAuthConfigured, OAUTH_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!githubAuthConfigured()) {
    return NextResponse.redirect(new URL("/?auth_error=GitHub+App+credentials+are+not+configured", request.url));
  }
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const returnToInput = request.nextUrl.searchParams.get("returnTo") ?? "/";
  const returnTo = returnToInput.startsWith("/") && !returnToInput.startsWith("//") ? returnToInput : "/";
  const callback = new URL("/api/auth/github/callback", request.url).toString();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", process.env.GITHUB_APP_CLIENT_ID ?? "");
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorize);
  response.cookies.set(OAUTH_COOKIE, seal(JSON.stringify({ state, verifier, returnTo, createdAt: Date.now() })), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
