import type { AnalyzeResult, ArchitectureNode, TraceResult, TraceStep } from "../../types/api";
import { rankRelevantNodes } from "./source-context";

/**
 * Deterministic, fully local feature tracing. Used whenever the optional
 * OpenAI provider is not configured. Every step cites a real node from the
 * analyzed architecture graph, so the same citation validation that guards
 * model output passes here by construction. No file or symbol is invented.
 */

const MAX_LOCAL_STEPS = 6;
const TYPE_ORDER: Record<ArchitectureNode["type"], number> = {
  route: 0,
  component: 1,
  api: 2,
  file: 3,
};

function describeNode(node: ArchitectureNode, analysis: AnalyzeResult): string {
  const location = node.locations[0];
  const file = analysis.files.find((candidate) => candidate.path === location?.file);
  const facts: string[] = [];
  if (node.type === "route") {
    facts.push(`The route "${node.label}" is defined in ${location?.file ?? "the repository"}.`);
  } else if (node.type === "component") {
    facts.push(`The component ${node.label} is implemented in ${location?.file}` + (location?.lineStart ? ` starting at line ${location.lineStart}.` : "."));
  } else if (node.type === "api") {
    facts.push(`The service function ${node.label} in ${location?.file} handles related data or side effects.`);
  } else {
    facts.push(`${location?.file} is involved in this feature.`);
  }
  if (file?.imports.length) {
    facts.push(`It imports ${file.imports.slice(0, 4).join(", ")}${file.imports.length > 4 ? ", …" : ""}.`);
  }
  if (file?.dependents.length) {
    facts.push(`It is used by ${file.dependents.slice(0, 4).join(", ")}${file.dependents.length > 4 ? ", …" : ""}.`);
  }
  if (node.fanIn > 0) facts.push(`${node.fanIn} other node${node.fanIn === 1 ? "" : "s"} depend on it.`);
  return facts.join(" ");
}

export function traceLocally(question: string, analysis: AnalyzeResult): TraceResult {
  const ranked = rankRelevantNodes(question, analysis);

  const ordered = [...ranked].sort(
    (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || b.fanIn - a.fanIn,
  );

  const seenFiles = new Set<string>();
  const steps: TraceStep[] = [];
  for (const node of ordered) {
    if (steps.length >= MAX_LOCAL_STEPS) break;
    const location = node.locations[0];
    if (!location) continue;
    // One step per file+symbol keeps the flow readable.
    const key = `${location.file}#${location.functionName ?? node.label}`;
    if (seenFiles.has(key)) continue;
    seenFiles.add(key);
    steps.push({ location: { ...location }, explanation: describeNode(node, analysis) });
  }

  const terms = question.toLowerCase().split(/[^a-z0-9_$-]+/).filter((term) => term.length > 2);
  const directLabelMatch = ranked.some((node) =>
    terms.some((term) => node.label.toLowerCase().includes(term)),
  );
  const confidence: TraceResult["confidence"] =
    steps.length === 0 ? "low" : directLabelMatch ? "medium" : "low";

  return { question, steps, confidence, provider: "local" };
}
