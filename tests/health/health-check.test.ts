import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnalysisSessionManager } from "../../src/lib/analyzer/analysis-session-manager";
import { packageRepositoryFiles, selectDevCommand } from "../../src/lib/preview/file-packager";
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

  it("Preview bundling works: packages the fixture for the in-browser runtime", async () => {
    const resolved = analyses.resolvePreviewRepository(analysis.analysisId, ".");
    expect(resolved).not.toBeNull();
    expect(resolved!.framework).toBe("vite");

    const files = await packageRepositoryFiles(resolved!.sourcePath);
    const paths = files.map((file) => file.path);
    expect(paths).toContain("package.json");
    expect(paths).toContain("index.html");
    expect(paths.some((path) => path.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((path) => path.startsWith(".env"))).toBe(false);

    const manifest = JSON.parse(
      files.find((file) => file.path === "package.json")!.contents,
    ) as { scripts?: Record<string, string> };
    const devCommand = selectDevCommand(Object.keys(manifest.scripts ?? {}));
    expect(devCommand).not.toBeNull();
    expect(devCommand!.args[0]).toBe("run");
  });

  it("Analysis works: builds routes, components, services, files, and edges", async () => {
    expect(analysis.routes).toEqual(expect.arrayContaining(["/", "/settings"]));
    expect(analysis.project).toMatchObject({ projectType: "frontend", previewAvailable: true });
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
