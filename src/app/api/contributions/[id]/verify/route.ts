import { NextResponse } from "next/server";
import { currentAuth } from "@/lib/auth/session";
import {
  ContributionVerificationError,
  verifyContribution,
} from "@/lib/contributions/verifier";
import {
  getContributionVerification,
  getSavedAnalysis,
  saveContributionVerification,
} from "@/lib/product/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await currentAuth();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  const existing = await getContributionVerification(auth.user.id, id);
  if (!existing) return NextResponse.json({ error: "Tracked contribution not found." }, { status: 404 });
  const saved = await getSavedAnalysis(auth.user.id, existing.analysisId);
  const finding = saved?.result.audit.findings.find((item) => item.id === existing.findingId);
  if (!saved || !finding) {
    return NextResponse.json({ error: "The original saved finding is no longer available." }, { status: 404 });
  }
  try {
    const verification = await verifyContribution({
      analysis: saved.result,
      finding,
      pullRequestUrl: existing.pullRequestUrl,
      accessToken: auth.accessToken,
      existing,
    });
    return NextResponse.json({
      contribution: await saveContributionVerification(auth.user.id, verification),
    });
  } catch (error) {
    if (error instanceof ContributionVerificationError) {
      const status = error.code === "NOT_AUTHORIZED" ? 403 : error.code === "NOT_FOUND" ? 404 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("Contribution reverification failed:", error);
    return NextResponse.json({ error: "The pull request could not be verified right now." }, { status: 500 });
  }
}
