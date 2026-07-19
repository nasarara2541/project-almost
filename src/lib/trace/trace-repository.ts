import type { AnalyzeResult, TraceResult } from "../../types/api";
import type { AnalysisRepository } from "../analyzer/repository-analyzer";
import { traceLocally } from "./local-trace";
import { openAiTraceConfigured, requestTraceFromOpenAi } from "./openai-trace";
import { selectRelevantSourceContext } from "./source-context";
import { validateAndCanonicalizeTrace } from "./trace-result";

export type TraceModel = (
  question: string,
  analysis: AnalyzeResult,
  context: Awaited<ReturnType<typeof selectRelevantSourceContext>>,
) => Promise<TraceResult>;

/**
 * Answers a feature question about the analyzed repository.
 *
 * Provider selection: the OpenAI model is used only when OPENAI_API_KEY is
 * configured; otherwise the deterministic local analyzer produces the
 * answer and the result is labeled `provider: "local"` — it is never
 * presented as model output. Both paths run the same citation validation.
 */
export async function traceRepositoryFeature(
  question: string,
  analysis: AnalyzeResult,
  repository: AnalysisRepository,
  model?: TraceModel,
): Promise<TraceResult> {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) throw new Error("Question must not be empty.");
  const context = await selectRelevantSourceContext(normalizedQuestion, analysis, repository);

  const useOpenAi = model !== undefined || openAiTraceConfigured();
  const provider: TraceResult["provider"] = model !== undefined ? undefined : useOpenAi ? "openai" : "local";

  if (!useOpenAi) {
    const local = traceLocally(normalizedQuestion, analysis);
    return validateAndCanonicalizeTrace(local, analysis, normalizedQuestion);
  }

  if (context.files.length === 0) {
    return { question: normalizedQuestion, steps: [], confidence: "low", ...(provider ? { provider } : {}) };
  }
  const candidate = await (model ?? requestTraceFromOpenAi)(normalizedQuestion, analysis, context);
  const validated = validateAndCanonicalizeTrace(candidate, analysis, normalizedQuestion);
  return provider ? { ...validated, provider } : validated;
}
