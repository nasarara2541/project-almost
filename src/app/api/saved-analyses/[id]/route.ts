import { NextResponse } from "next/server";
import { currentAuth } from "@/lib/auth/session";
import { getSavedAnalysis, listContributionFeedback } from "@/lib/product/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await currentAuth();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  const saved = await getSavedAnalysis(auth.user.id, id);
  if (!saved) return NextResponse.json({ error: "Saved analysis not found." }, { status: 404 });
  const feedback = await listContributionFeedback(auth.user.id, id);
  return NextResponse.json({ analysis: saved.result, profile: saved.profile, feedback }, {
    headers: { "Cache-Control": "no-store" },
  });
}
