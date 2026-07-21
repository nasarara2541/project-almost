import { NextResponse } from "next/server";
import { analysisSessionManager } from "@/lib/analyzer/analysis-session-manager";
import { isRemoteRepositoryError } from "@/lib/analyzer/github-source";
import { SourceAnalysisError } from "@/lib/analyzer/repository-analyzer";
import { RepositoryValidationError } from "@/lib/preview/repositories";
import { currentAuth } from "@/lib/auth/session";
import { saveAnalysis } from "@/lib/product/store";
import type { ContributorProfile } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { repoUrl?: unknown; profile?: unknown };
    if (typeof body.repoUrl !== "string" || !body.repoUrl.trim()) {
      return NextResponse.json({ error: "repoUrl must be a non-empty string." }, { status: 400 });
    }
    const auth = await currentAuth();
    const profile = isContributorProfile(body.profile)
      ? body.profile
      : { experience: "new", time: "two-hours", focus: "any" } satisfies ContributorProfile;
    const analysis = await analysisSessionManager.create(body.repoUrl, { accessToken: auth?.accessToken });
    if (auth) await saveAnalysis({ userId: auth.user.id, analysis, profile });
    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (error instanceof SourceAnalysisError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof RepositoryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isRemoteRepositoryError(error)) {
      const status = error.code === "NOT_FOUND" ? 404
        : error.code === "NOT_AUTHORIZED" ? 403
        : error.code === "RATE_LIMITED" ? 429 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("POST /api/analyze failed:", error);
    return NextResponse.json(
      { error: "The repository could not be analyzed." },
      { status: 500 },
    );
  }
}

function isContributorProfile(value: unknown): value is ContributorProfile {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return ["new", "comfortable", "advanced"].includes(String(input.experience))
    && ["half-hour", "two-hours", "weekend"].includes(String(input.time))
    && ["any", "docs", "tests", "cleanup", "frontend"].includes(String(input.focus));
}
