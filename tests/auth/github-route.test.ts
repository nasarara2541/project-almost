import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../../src/app/api/auth/github/route";

const previous = {
  clientId: process.env.GITHUB_APP_CLIENT_ID,
  clientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
  authSecret: process.env.AUTH_SECRET,
};

afterEach(() => {
  if (previous.clientId === undefined) delete process.env.GITHUB_APP_CLIENT_ID;
  else process.env.GITHUB_APP_CLIENT_ID = previous.clientId;

  if (previous.clientSecret === undefined) delete process.env.GITHUB_APP_CLIENT_SECRET;
  else process.env.GITHUB_APP_CLIENT_SECRET = previous.clientSecret;

  if (previous.authSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = previous.authSecret;
});

describe("GitHub authorization route", () => {
  it("uses GitHub's registered callback instead of a Vercel deployment hostname", async () => {
    process.env.GITHUB_APP_CLIENT_ID = "github-client-id";
    process.env.GITHUB_APP_CLIENT_SECRET = "github-client-secret";
    process.env.AUTH_SECRET = "a-test-auth-secret-that-is-at-least-32-characters";

    const response = await GET(
      new NextRequest("https://internal-deployment.vercel.app/api/auth/github"),
    );
    const authorizationUrl = new URL(response.headers.get("location") ?? "");

    expect(authorizationUrl.hostname).toBe("github.com");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("github-client-id");
    expect(authorizationUrl.searchParams.has("redirect_uri")).toBe(false);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
