import { NextRequest, NextResponse } from "next/server";
import { currentAuth } from "@/lib/auth/session";
import {
  getSavedAnalysis,
  listContributionFeedback,
  saveContributionFeedback,
} from "@/lib/product/store";
import type { FeedbackVerdict } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verdicts = new Set<FeedbackVerdict>(["useful", "started", "completed", "inaccurate", "not-relevant"]);

export async function GET(request: NextRequest) {
  const auth = await currentAuth();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const analysisId = request.nextUrl.searchParams.get("analysisId");
  if (!analysisId) return NextResponse.json({ error: "analysisId is required." }, { status: 400 });
  const saved = await getSavedAnalysis(auth.user.id, analysisId);
  if (!saved) return NextResponse.json({ error: "Saved analysis not found." }, { status: 404 });
  return NextResponse.json({ feedback: await listContributionFeedback(auth.user.id, analysisId) });
}

export async function POST(request: Request) {
  const auth = await currentAuth();
  if (!auth) return NextResponse.json({ error: "Sign in to record feedback." }, { status: 401 });
  const body = await request.json() as {
    analysisId?: unknown;
    findingId?: unknown;
    verdict?: unknown;
    note?: unknown;
  };
  if (typeof body.analysisId !== "string" || typeof body.findingId !== "string"
    || !verdicts.has(body.verdict as FeedbackVerdict)) {
    return NextResponse.json({ error: "analysisId, findingId, and a valid verdict are required." }, { status: 400 });
  }
  const saved = await getSavedAnalysis(auth.user.id, body.analysisId);
  if (!saved || !saved.result.audit.findings.some((finding) => finding.id === body.findingId)) {
    return NextResponse.json({ error: "Finding not found in this saved analysis." }, { status: 404 });
  }
  await saveContributionFeedback({
    userId: auth.user.id,
    analysisId: body.analysisId,
    findingId: body.findingId,
    verdict: body.verdict as FeedbackVerdict,
    note: typeof body.note === "string" ? body.note.slice(0, 1_000) : null,
  });
  return NextResponse.json({ ok: true });
}
