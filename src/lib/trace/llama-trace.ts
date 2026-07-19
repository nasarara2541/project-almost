import type { AnalyzeResult, TraceResult } from "../../types/api";
import type { RelevantSourceContext } from "./source-context";
import { parseTraceResult } from "./trace-result";

/**
 * Feature tracing via the Llama API (https://api.llama.com), which offers a
 * free developer tier. The OpenAI-compatible chat completions endpoint is
 * used so structured JSON-schema output keeps working exactly as before.
 *
 * Configuration:
 * - LLAMA_API_KEY      (required)
 * - LLAMA_API_BASE_URL (optional, defaults to https://api.llama.com/compat/v1)
 * - LLAMA_TRACE_MODEL  (optional, defaults to Llama-4-Maverick-17B-128E-Instruct-FP8)
 */

const DEFAULT_BASE_URL = "https://api.llama.com/compat/v1";
const DEFAULT_MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8";

const TRACE_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["question", "steps", "confidence"],
  properties: {
    question: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["location", "explanation"],
        properties: {
          explanation: { type: "string" },
          location: {
            type: "object",
            additionalProperties: false,
            required: ["file", "lineStart", "lineEnd", "functionName"],
            properties: {
              file: { type: "string" },
              lineStart: { type: ["integer", "null"], minimum: 1 },
              lineEnd: { type: ["integer", "null"], minimum: 1 },
              functionName: { type: ["string", "null"] },
            },
          },
        },
      },
    },
  },
} as const;

export class ModelConfigurationError extends Error {
  constructor(message = "Feature tracing requires LLAMA_API_KEY configuration.") {
    super(message);
    this.name = "ModelConfigurationError";
  }
}

export class TraceModelError extends Error {
  constructor(message = "The tracing model could not produce a result.") {
    super(message);
    this.name = "TraceModelError";
  }
}

type ChatCompletionsPayload = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  completion_message?: { content?: { text?: string } | string };
  error?: { message?: string };
};

function responseText(payload: ChatCompletionsPayload): string | null {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part.text === "string" && part.text.trim()) return part.text;
    }
  }
  // Native Llama API shape fallback.
  const native = payload.completion_message?.content;
  if (typeof native === "string" && native.trim()) return native;
  if (native && typeof native === "object" && typeof native.text === "string") return native.text;
  return null;
}

function stripCodeFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

function repositoryIndex(analysis: AnalyzeResult, context: RelevantSourceContext): string {
  const relevant = new Set(context.nodeIds);
  return analysis.graph.nodes
    .filter((node) => relevant.has(node.id))
    .map((node) =>
      JSON.stringify({
        id: node.id,
        type: node.type,
        label: node.label,
        locations: node.locations,
      }),
    )
    .join("\n");
}

export async function requestTraceFromLlama(
  question: string,
  analysis: AnalyzeResult,
  context: RelevantSourceContext,
  options: { apiKey?: string; model?: string; baseUrl?: string; fetcher?: typeof fetch } = {},
): Promise<TraceResult> {
  const apiKey = options.apiKey ?? process.env.LLAMA_API_KEY;
  const model = options.model ?? process.env.LLAMA_TRACE_MODEL ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? process.env.LLAMA_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  if (!apiKey?.trim()) throw new ModelConfigurationError();

  const sourceContext = context.files
    .map((file) => `FILE: ${file.path}\n\`\`\`\n${file.source}\n\`\`\``)
    .join("\n\n");

  const response = await (options.fetcher ?? fetch)(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Trace product behavior using only the supplied repository index and source excerpts. " +
            "Never invent a file, symbol, route, or source location. Return the shortest useful ordered flow. " +
            "If the evidence is insufficient, return an empty steps array with low confidence. " +
            "Respond with a single JSON object matching the required schema and nothing else.",
        },
        {
          role: "user",
          content: `QUESTION:\n${question}\n\nREPOSITORY INDEX:\n${repositoryIndex(analysis, context)}\n\nSOURCE EXCERPTS:\n${sourceContext}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "trace_result",
          strict: true,
          schema: TRACE_RESULT_SCHEMA,
        },
      },
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionsPayload;
  if (!response.ok) {
    throw new TraceModelError(
      payload.error?.message || `Tracing model returned HTTP ${response.status}.`,
    );
  }
  const output = responseText(payload);
  if (!output) throw new TraceModelError("The tracing model returned no structured result.");
  return parseTraceResult(stripCodeFences(output));
}
