import { NextResponse } from "next/server";
import { analysisSessionManager } from "@/lib/analyzer/analysis-session-manager";
import { isRemoteRepositoryError } from "@/lib/analyzer/github-source";
import { RepositoryValidationError } from "@/lib/preview/repositories";
import { ModelConfigurationError, TraceModelError } from "@/lib/trace/openai-trace";
import { traceRepositoryFeature } from "@/lib/trace/trace-repository";
import { TraceValidationError } from "@/lib/trace/trace-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let transientAnalysisId: string | null = null;
  try {
    const body = (await request.json()) as {
      analysisId?: unknown;
      sessionId?: unknown;
      repoUrl?: unknown;
      question?: unknown;
    };
    const analysisId =
      typeof body.analysisId === "string"
        ? body.analysisId
        : typeof body.sessionId === "string"
          ? body.sessionId
          : "";
    if (!analysisId.trim()) {
      return NextResponse.json({ error: "analysisId must be a non-empty string." }, { status: 400 });
    }
    if (typeof body.question !== "string" || !body.question.trim()) {
      return NextResponse.json(
        { error: "Enter a question about the analyzed repository.", code: "EMPTY_QUESTION" },
        { status: 400 },
      );
    }
    if (body.question.length > 500) {
      return NextResponse.json({ error: "Questions are limited to 500 characters." }, { status: 400 });
    }

    let record = analysisSessionManager.get(analysisId);
    // Analysis sessions are held in memory. If a serverless request lands on
    // another instance, re-create the bounded read-only analysis from repoUrl
    // instead of making feature tracing fail mysteriously.
    if (!record && typeof body.repoUrl === "string" && body.repoUrl.trim()) {
      const recreated = await analysisSessionManager.create(body.repoUrl);
      transientAnalysisId = recreated.analysisId;
      record = analysisSessionManager.get(recreated.analysisId);
    }
    if (!record) {
      return NextResponse.json(
        { error: "Analysis session expired. Run the repository audit again." },
        { status: 404 },
      );
    }
    const trace = await traceRepositoryFeature(body.question, record.result, record.repository);
    return NextResponse.json(trace, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (error instanceof RepositoryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isRemoteRepositoryError(error)) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "RATE_LIMITED" ? 429 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof ModelConfigurationError) {
      return NextResponse.json(
        { error: error.message, code: "MODEL_CONFIGURATION" },
        { status: 503 },
      );
    }
    if (error instanceof TraceValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    }
    if (error instanceof TraceModelError) {
      return NextResponse.json({ error: error.message, code: "MODEL_ERROR" }, { status: 502 });
    }
    return NextResponse.json(
      { error: "The grounded feature trace could not be created.", code: "MODEL_ERROR" },
      { status: 500 },
    );
  } finally {
    if (transientAnalysisId) await analysisSessionManager.delete(transientAnalysisId);
  }
}
