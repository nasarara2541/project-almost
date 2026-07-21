import { NextResponse } from "next/server";
import { currentAuth } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GithubRepository = {
  full_name: string;
  html_url: string;
  private: boolean;
  updated_at: string;
};

export async function GET() {
  const auth = await currentAuth();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${auth.accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "RepoLens",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    return NextResponse.json({ error: "Installed GitHub repositories could not be loaded." }, { status: response.status });
  }
  const repositories = await response.json() as GithubRepository[];
  return NextResponse.json({
    repositories: repositories.map((repository) => ({
      name: repository.full_name,
      url: repository.html_url,
      private: repository.private,
      updatedAt: repository.updated_at,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
