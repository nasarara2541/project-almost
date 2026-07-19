import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Previews now execute entirely inside the visitor's browser (WebContainers),
 * so there is no server-side preview session to poll or stop. These routes
 * remain only so old clients receive a clear explanation instead of a 404.
 */
const GONE = {
  error:
    "Server-side preview sessions were replaced by in-browser previews. POST /api/preview returns a runnable bundle instead.",
};

export async function GET() {
  return NextResponse.json(GONE, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json(GONE, { status: 410 });
}
