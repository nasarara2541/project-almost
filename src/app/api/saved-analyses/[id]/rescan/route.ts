import { NextResponse } from "next/server";
import { analysisSessionManager } from "@/lib/analyzer/analysis-session-manager";
import { isRemoteRepositoryError } from "@/lib/analyzer/github-source";
import { currentAuth } from "@/lib/auth/session";
import { getSavedAnalysis, saveAnalysis } from "@/lib/product/store";
import type { AnalysisComparison, AuditFinding } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function findingSummary(finding: AuditFinding) {
  return { id: finding.id, title: finding.title };
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await currentAuth();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  const saved = await getSavedAnalysis(auth.user.id, id);
  if (!saved) return NextResponse.json({ error: "Saved analysis not found." }, { status: 404 });
  try {
    const analysis = await analysisSessionManager.create(saved.repoUrl, { accessToken: auth.accessToken });
    await saveAnalysis({ userId: auth.user.id, analysis, profile: saved.profile, parentId: saved.id });
    const previous = new Map(saved.result.audit.findings.map((finding) => [finding.id, finding]));
    const current = new Map(analysis.audit.findings.map((finding) => [finding.id, finding]));
    const comparison: AnalysisComparison = {
      previousAnalysisId: saved.id,
      currentAnalysisId: analysis.analysisId,
      added: [...current.values()].filter((finding) => !previous.has(finding.id)).map(findingSummary),
      resolved: [...previous.values()].filter((finding) => !current.has(finding.id)).map(findingSummary),
      unchangedCount: [...current.keys()].filter((findingId) => previous.has(findingId)).length,
    };
    return NextResponse.json({ analysis, profile: saved.profile, comparison }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isRemoteRepositoryError(error)) {
      const status = error.code === "NOT_AUTHORIZED" ? 403 : error.code === "RATE_LIMITED" ? 429 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("Saved analysis rescan failed:", error);
    return NextResponse.json({ error: "The repository could not be rescanned." }, { status: 500 });
  }
}
