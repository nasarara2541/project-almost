import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAuditMarkdown } from "../../src/lib/audit/markdown-report";
import { detectRepositoryProject } from "../../src/lib/analyzer/project-detector";
import { analyzeRepository, type AnalysisRepository } from "../../src/lib/analyzer/repository-analyzer";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files: Record<string, string>): Promise<AnalysisRepository> {
  const root = await mkdtemp(path.join(tmpdir(), "repolens-audit-"));
  roots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return { repoUrl: "https://github.com/example/audit-fixture", sourcePath: root };
}

async function analyze(repository: AnalysisRepository) {
  const project = await detectRepositoryProject(repository, { defaultBranch: "main" });
  return analyzeRepository(repository, "audit-test", project);
}

const healthyCommunityFiles = {
  "README.md": "# Example\n\n## Installation\n\n```bash\nnpm install\nnpm run dev\n```\n",
  LICENSE: "MIT License",
  "CONTRIBUTING.md": "Run npm test before opening a pull request.",
  "CODE_OF_CONDUCT.md": "Be respectful.",
  "SECURITY.md": "Report security issues privately.",
  ".github/ISSUE_TEMPLATE/bug.yml": "name: Bug",
  ".github/pull_request_template.md": "## What changed?",
};

describe("repository audit", () => {
  it("produces catalog-specific work and avoids duplicating open pull requests", async () => {
    const mainLinks = Array.from(
      { length: 35 },
      (_, index) => `- [Project ${index}](${index === 0 ? "http" : "https"}://github.com/example/project-${index})`,
    ).join("\n");
    const translatedLinks = Array.from(
      { length: 12 },
      (_, index) => `- [Project ${index}](https://github.com/example/project-${index})`,
    ).join("\n");
    const repository = await fixture({
      "README.md": `# Android catalog\n\n${mainLinks}\n`,
      "translations/README.md": `# Android catalog translation\n\n${translatedLinks}\n`,
      LICENSE: "Apache License 2.0",
    });
    repository.activity = {
      archived: false,
      pushedAt: "2026-03-25T01:04:16Z",
      openIssueCount: 20,
      pullRequestScan: "complete",
      openPullRequests: [
        { number: 441, title: "fix: upgrade http:// to https:// in README", url: "https://github.com/example/catalog/pull/441", createdAt: "2026-07-18T00:00:00Z", updatedAt: "2026-07-18T00:00:00Z", draft: false },
        { number: 383, title: "Create CODE_OF_CONDUCT.md", url: "https://github.com/example/catalog/pull/383", createdAt: "2020-07-27T00:00:00Z", updatedAt: "2020-07-27T00:00:00Z", draft: false },
        ...Array.from({ length: 8 }, (_, index) => ({
          number: 300 + index,
          title: `Update catalog entry ${index}`,
          url: `https://github.com/example/catalog/pull/${300 + index}`,
          createdAt: "2019-01-01T00:00:00Z",
          updatedAt: "2019-01-01T00:00:00Z",
          draft: false,
        })),
      ],
    };

    const result = await analyze(repository);

    expect(result.project.projectType).toBe("catalog");
    expect(result.audit.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining([
      "documentation:missing-link-check",
      "documentation:non-https-links",
      "documentation:translation-drift",
      "community:open-pull-request-backlog",
    ]));
    expect(result.audit.findings.find((finding) => finding.id === "documentation:non-https-links"))
      .toMatchObject({ contributionReady: false });
    expect(result.audit.findings.find((finding) => finding.id === "community:missing-contributor-files"))
      .toMatchObject({ contributionReady: false });
    expect(result.audit.opportunities.map((item) => item.findingId)).toContain("documentation:missing-link-check");
    expect(result.audit.opportunities.map((item) => item.findingId)).not.toContain("documentation:non-https-links");
    expect(result.audit.categoryScores.map((category) => category.category)).toEqual([
      "community", "documentation-quality", "maintainability",
    ]);
    expect(result.audit.score).toBeLessThan(95);
    expect(result.audit.coverage.limitations.join(" ")).toMatch(/content rather than application source/i);
  });

  it("recognizes a well-documented project with tests and CI", async () => {
    const repository = await fixture({
      ...healthyCommunityFiles,
      "package.json": JSON.stringify({
        name: "healthy-app",
        engines: { node: ">=20" },
        scripts: { dev: "vite", build: "vite build", test: "vitest", lint: "eslint ." },
        dependencies: { react: "latest", vite: "latest" },
      }),
      ".github/workflows/ci.yml": "steps:\n  - run: npm test\n  - run: npm run build\n",
      "src/main.tsx": "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.body).render(<App />);",
      "src/App.tsx": "export function App() { return <main><img src='logo.png' alt='Example logo' /></main>; }",
      "tests/App.test.tsx": "export const testName = 'renders';",
    });
    const result = await analyze(repository);

    expect(result.audit.coverage.coveragePercent).toBe(100);
    expect(result.audit.findings.some((finding) => finding.id === "community:missing-readme")).toBe(false);
    expect(result.audit.findings.some((finding) => finding.id === "community:missing-license")).toBe(false);
    expect(result.audit.findings.some((finding) => finding.id === "testing:no-tests")).toBe(false);
    expect(result.audit.strengths.map((strength) => strength.id)).toEqual(
      expect.arrayContaining(["community:readme", "community:license", "testing:tests", "testing:ci"]),
    );
  });

  it("lists possibly unreferenced files by name without flagging entry points, routes, tests, or imported files", async () => {
    const repository = await fixture({
      "package.json": JSON.stringify({
        name: "gappy-app",
        scripts: { dev: "vite", build: "vite build" },
        dependencies: { react: "latest", vite: "latest" },
      }),
      "src/main.tsx": "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.body).render(<App />);",
      "src/App.tsx": "import { Used } from './Used'; export function App() { return <Used />; }",
      "src/Used.tsx": "export function Used() { return <p>Used</p>; }",
      "src/UnusedComponent.tsx": "export function UnusedComponent() { return <aside>Unused</aside>; }",
      "src/__mocks__/fake.ts": "export const fake = true;",
      "src/module.ts": "export const plugin = true;",
      "src/pages/settings.tsx": "export function SettingsPage() { return <main>Settings</main>; }",
      "tests/helper.ts": "export const helper = true;",
      ".prettierrc.js": "export default {};",
      "jest-setup.js": "export const setup = true;",
      "vite.config.ts": "export default {};",
    });
    const result = await analyze(repository);
    const finding = result.audit.findings.find(
      (item) => item.id === "maintainability:possibly-unreferenced",
    );

    expect(finding).toBeDefined();
    expect(finding?.files).toEqual(["src/UnusedComponent.tsx"]);
    expect(finding?.summary).toContain("src/UnusedComponent.tsx");
    expect(finding?.limitation).toMatch(/not proof of dead code/i);
    expect(result.audit.opportunities.find((item) => item.findingId === finding?.id)?.task)
      .toContain("src/UnusedComponent.tsx");
  });

  it("resolves common @/ aliases before calculating zero-reference candidates", async () => {
    const repository = await fixture({
      "package.json": JSON.stringify({
        name: "alias-app",
        scripts: { dev: "vite", build: "vite build" },
        dependencies: { react: "latest", vite: "latest" },
      }),
      "src/main.tsx": "import { createRoot } from 'react-dom/client'; import { App } from '@/App'; createRoot(document.body).render(<App />);",
      "src/App.tsx": "void process.env.NODE_ENV; void process.env.CI; export function App() { return <main>App</main>; }",
      "src/unused.ts": "export const unused = true;",
    });
    const result = await analyze(repository);
    const finding = result.audit.findings.find(
      (item) => item.id === "maintainability:possibly-unreferenced",
    );

    expect(result.files.find((file) => file.path === "src/App.tsx")?.dependents).toEqual(["src/main.tsx"]);
    expect(finding?.files).toContain("src/unused.ts");
    expect(finding?.files).not.toContain("src/App.tsx");
    expect(result.audit.findings.find((item) => item.id === "devex:missing-env-example")).toBeUndefined();
  });

  it("uses tsconfig path aliases when calculating source relationships", async () => {
    const repository = await fixture({
      "package.json": JSON.stringify({ name: "paths-app", scripts: { dev: "vite" }, dependencies: { react: "latest", vite: "latest" } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "ui/*": ["src/*"] } } }),
      "src/main.tsx": "import { createRoot } from 'react-dom/client'; import { App } from 'ui/App'; createRoot(document.body).render(<App />);",
      "src/App.tsx": "export function App() { return <main>App</main>; }",
    });
    const result = await analyze(repository);

    expect(result.files.find((file) => file.path === "src/App.tsx")?.dependents).toEqual(["src/main.tsx"]);
    expect(result.audit.findings.find((item) => item.id === "maintainability:possibly-unreferenced")?.files ?? [])
      .not.toContain("src/App.tsx");
  });

  it("continues the audit and names malformed package manifests", async () => {
    const repository = await fixture({
      "README.md": "# Broken manifest example\n",
      "package.json": '{ "name": "broken", "scripts": { "test": "vitest" }',
      "src/index.ts": "export const value = 1;",
    });
    const result = await analyze(repository);
    const finding = result.audit.findings.find(
      (item) => item.id === "devex:invalid-package-manifest",
    );

    expect(finding).toMatchObject({
      severity: "high",
      confidence: "high",
      files: ["package.json"],
    });
    expect(finding?.contributionTask).toContain("package.json");
  });

  it("reports skipped-file coverage and exports the evidence to Markdown", async () => {
    const repository = await fixture({
      ...healthyCommunityFiles,
      "package.json": JSON.stringify({ name: "partial", scripts: { test: "vitest" } }),
      "src/index.ts": "export const value = 1;",
      "tests/index.test.ts": "export const verifies = true;",
    });
    repository.acquisition = {
      repositoryFiles: 12,
      supportedFiles: 10,
      fetchedFiles: 9,
      skippedFiles: [{ path: "generated/bundle.js", size: 700_000, reason: "oversized" }],
    };
    const result = await analyze(repository);

    expect(result.audit.coverage).toMatchObject({
      repositoryFiles: 12,
      supportedFiles: 10,
      fetchedFiles: 9,
      coveragePercent: 90,
      complete: false,
    });
    expect(result.audit.findings.find((item) => item.id === "maintainability:oversized-skipped-files")?.files)
      .toEqual(["generated/bundle.js"]);
    const report = createAuditMarkdown(result);
    expect(report).toContain("generated/bundle.js");
    expect(report).toContain("## Contribution opportunities");
  });
});
