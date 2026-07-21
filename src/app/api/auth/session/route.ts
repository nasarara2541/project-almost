import { NextResponse } from "next/server";
import { currentAuth, githubAuthConfigured } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await currentAuth();
  return NextResponse.json({
    configured: githubAuthConfigured(),
    user: auth ? auth.user : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
