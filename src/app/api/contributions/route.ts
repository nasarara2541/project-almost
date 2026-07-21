import { NextRequest, NextResponse } from "next/server";
import { currentAuth } from "@/lib/auth/session";
import {
  ContributionVerificationError,
  verifyContribution,
} from "@/lib/contributions/verifier";
import {
  getContributionVerificationForFinding,
  getSavedAnalysis,
  listContributionVerifications,
  saveContributionVerification,
} from "@/lib/product/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verificationError(error: unknown) {
  if (error instanceof ContributionVerificationError) {
    const status = error.code === "INVALID_PR" || error.code === "WRONG_REPOSITORY"
      ? 400
      : error.code === "NOT_FOUND"
        ? 404
        : error.code === "NOT_AUTHORIZED"
          ? 403
          : 422;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  console.error("Contribution verification failed:", error);
  return NextResponse.json({ error: "The pull request could not be verified right now." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const auth = await currentAuth();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const analysisId = request.nextUrl.searchParams.get("analysisId");
  if (!analysisId) return NextResponse.json({ error: "analysisId is required." }, { status: 400 });
  const saved = await getSavedAnalysis(auth.user.id, analysisId);
  if (!saved) return NextResponse.json({ error: "Saved analysis not found." }, { status: 404 });
  return NextResponse.json(
    { contributions: await listContributionVerifications(auth.user.id, analysisId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await currentAuth();
  if (!auth) return NextResponse.json({ error: "Sign in with GitHub to verify a contribution." }, { status: 401 });
  const body = await request.json() as {
    analysisId?: unknown;
    findingId?: unknown;
    pullRequestUrl?: unknown;
  };
  if (
    typeof body.analysisId !== "string" || typeof body.findingId !== "string" ||
    typeof body.pullRequestUrl !== "string" || body.pullRequestUrl.length > 500
  ) {
    return NextResponse.json(
      { error: "analysisId, findingId, and a GitHub pull request URL are required." },
      { status: 400 },
    );
  }
  const saved = await getSavedAnalysis(auth.user.id, body.analysisId);
  const finding = saved?.result.audit.findings.find((item) => item.id === body.findingId);
  if (!saved || !finding) {
    return NextResponse.json({ error: "Finding not found in this saved analysis." }, { status: 404 });
  }
  try {
    const existing = await getContributionVerificationForFinding(
      auth.user.id,
      saved.id,
      finding.id,
    );
    const verification = await verifyContribution({
      analysis: saved.result,
      finding,
      pullRequestUrl: body.pullRequestUrl,
      accessToken: auth.accessToken,
      existing,
    });
    return NextResponse.json({
      contribution: await saveContributionVerification(auth.user.id, verification),
    });
  } catch (error) {
    return verificationError(error);
  }
}
