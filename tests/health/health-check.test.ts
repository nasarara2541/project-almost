import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnalysisSessionManager } from "../../src/lib/analyzer/analysis-session-manager";
import { createAuditMarkdown } from "../../src/lib/audit/markdown-report";
import { getAllowedRepositories } from "../../src/lib/preview/repositories";
import { traceRepositoryFeature } from "../../src/lib/trace/trace-repository";
import type { AnalyzeResult } from "../../src/types/api";

describe.sequential("RepoLens final health check", () => {
  const repository = getAllowedRepositories()[0];
  const analyses = new AnalysisSessionManager(60_000);
  let analysis: AnalyzeResult;

  beforeAll(async () => {
    analysis = await analyses.create(repository.repoUrl);
  }, 30_000);

  afterAll(async () => {
    await analyses.dispose();
  });

  it("Audit works: produces evidence, opportunities, coverage, and an export", () => {
    expect(analysis.audit.findings.length).toBeGreaterThan(0);
    expect(analysis.audit.opportunities.length).toBeGreaterThan(0);
    expect(analysis.audit.coverage.coveragePercent).toBe(100);
    expect(createAuditMarkdown(analysis)).toContain("# RepoLens audit:");
  });

  it("Analysis works: builds routes, components, services, files, and edges", async () => {
    expect(analysis.routes).toEqual(expect.arrayContaining(["/", "/settings"]));
    expect(analysis.project).toMatchObject({ projectType: "frontend" });
    expect(analysis.graph.nodes.some((node) => node.type === "component")).toBe(true);
    expect(analysis.graph.nodes.some((node) => node.type === "api")).toBe(true);
    expect(analysis.graph.edges.length).toBeGreaterThan(0);
  });

  it("Trace fallback works: unrelated questions skip the model safely", async () => {
    const trace = await traceRepositoryFeature(
      "Who composed the soundtrack?",
      analysis,
      repository,
      async () => {
        throw new Error("The fallback must not call the model.");
      },
    );
    expect(trace).toEqual({
      question: "Who composed the soundtrack?",
      steps: [],
      confidence: "low",
    });
  });

  it("Cleanup works: analysis records are removed on delete", async () => {
    expect(await analyses.delete(analysis.analysisId)).toBe(true);
    expect(analyses.getResult(analysis.analysisId)).toBeNull();
  });
});
