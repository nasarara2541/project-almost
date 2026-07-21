import { NextResponse } from "next/server";
import { verifyGithubWebhookSignature } from "@/lib/contributions/webhook";
import { markContributionRefreshNeeded } from "@/lib/product/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PullReference = { number?: number; base?: { repo?: { full_name?: string } } };
type WebhookPayload = {
  number?: number;
  repository?: { full_name?: string };
  pull_request?: PullReference;
  check_run?: { pull_requests?: PullReference[] };
};

function target(fullName: string | undefined, pullNumber: number | undefined) {
  const parts = fullName?.split("/");
  if (!parts || parts.length !== 2 || !pullNumber) return null;
  return { owner: parts[0], repo: parts[1], pullNumber };
}

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook secret is not configured." }, { status: 503 });
  const body = await request.text();
  if (!verifyGithubWebhookSignature(body, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") ?? "";
  if (!["pull_request", "pull_request_review", "check_run"].includes(event)) {
    return NextResponse.json({ accepted: true, updated: 0 }, { status: 202 });
  }
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }
  const targets = event === "check_run"
    ? (payload.check_run?.pull_requests ?? []).map((pull) => target(pull.base?.repo?.full_name, pull.number))
    : [target(payload.repository?.full_name, payload.pull_request?.number ?? payload.number)];
  const unique = new Map(
    targets.filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => [`${item.owner.toLowerCase()}/${item.repo.toLowerCase()}#${item.pullNumber}`, item]),
  );
  const updated = (await Promise.all(
    [...unique.values()].map((item) => markContributionRefreshNeeded(item.owner, item.repo, item.pullNumber)),
  )).reduce((sum, count) => sum + count, 0);
  return NextResponse.json({ accepted: true, updated }, { status: 202 });
}
