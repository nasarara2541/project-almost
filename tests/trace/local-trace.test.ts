import { afterEach, describe, expect, it } from "vitest";
import { analyzeRepository } from "../../src/lib/analyzer/repository-analyzer";
import { getAllowedRepositories } from "../../src/lib/preview/repositories";
import { traceLocally } from "../../src/lib/trace/local-trace";
import { traceRepositoryFeature } from "../../src/lib/trace/trace-repository";
import { validateAndCanonicalizeTrace } from "../../src/lib/trace/trace-result";

const originalKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

async function fixtureAnalysis() {
  const repository = getAllowedRepositories()[0];
  return { repository, analysis: await analyzeRepository(repository, "local-trace-test") };
}

describe("deterministic local tracing", () => {
  it("answers with real citations that pass the same validation as model output", async () => {
    const { analysis } = await fixtureAnalysis();
    const trace = traceLocally("How does the settings page work?", analysis);

    expect(trace.provider).toBe("local");
    expect(trace.steps.length).toBeGreaterThan(0);
    expect(trace.steps.map((step) => step.location.file)).toContain("src/pages/SettingsPage.tsx");
    expect(trace.steps.map((step) => step.location.file)).not.toContain("src/pages/HomePage.tsx");
    // Every cited file/symbol must exist in the analysis — validation throws otherwise.
    expect(() => validateAndCanonicalizeTrace(trace, analysis)).not.toThrow();
  });

  it("returns an honest empty result for unanswerable questions", async () => {
    const { analysis } = await fixtureAnalysis();
    const trace = traceLocally("Who composed the soundtrack?", analysis);
    expect(trace.steps).toHaveLength(0);
    expect(trace.confidence).toBe("low");
  });

  it("is used automatically when OPENAI_API_KEY is missing and labeled as local", async () => {
    delete process.env.OPENAI_API_KEY;
    const { repository, analysis } = await fixtureAnalysis();
    const result = await traceRepositoryFeature(
      "How does the settings page work?",
      analysis,
      repository,
    );
    expect(result.provider).toBe("local");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.every((step) => analysis.files.some((file) => file.path === step.location.file))).toBe(true);
  });

  it("never pretends local output came from a model", async () => {
    delete process.env.OPENAI_API_KEY;
    const { repository, analysis } = await fixtureAnalysis();
    const result = await traceRepositoryFeature("Which code creates the home screen?", analysis, repository);
    expect(result.provider).not.toBe("openai");
  });
});
