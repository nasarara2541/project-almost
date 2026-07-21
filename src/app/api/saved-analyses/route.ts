import { NextResponse } from "next/server";
import { currentAuth } from "@/lib/auth/session";
import { listSavedAnalyses } from "@/lib/product/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await currentAuth();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const analyses = await listSavedAnalyses(auth.user.id);
  return NextResponse.json({ analyses }, { headers: { "Cache-Control": "no-store" } });
}
