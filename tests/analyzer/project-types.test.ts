import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectRepositoryProject } from "../../src/lib/analyzer/project-detector";

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "repolens-detect-"));
}

describe("extended project type detection", () => {
  it("detects a Chrome extension via manifest.json", async () => {
    const root = await scratch();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "my-extension", scripts: { build: "vite build" }, devDependencies: {} }),
    );
    await writeFile(
      path.join(root, "manifest.json"),
      JSON.stringify({ manifest_version: 3, name: "My Extension", version: "1.0" }),
    );
    const project = await detectRepositoryProject(
      { repoUrl: "https://github.com/example/extension", sourcePath: root },
      {},
    );
    expect(project.projectType).toBe("chrome-extension");
    expect(project.previewAvailable).toBe(false);
    expect(project.previewReason).toMatch(/live preview unsupported/i);
    expect(project.previewReason).toMatch(/extension/i);
  });

  it("detects a Python project with no package.json", async () => {
    const root = await scratch();
    await writeFile(path.join(root, "pyproject.toml"), "[project]\nname = \"tool\"\n");
    await writeFile(path.join(root, "main.py"), "print('hi')\n");
    const project = await detectRepositoryProject(
      { repoUrl: "https://github.com/example/pytool", sourcePath: root },
      {},
    );
    expect(project.projectType).toBe("python");
    expect(project.packageManagers).toContain("pip");
    expect(project.previewAvailable).toBe(false);
    expect(project.previewReason).toMatch(/python/i);
  });

  it("detects a Node CLI tool via the bin field", async () => {
    const root = await scratch();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "clitool", bin: { clitool: "./cli.js" }, scripts: { start: "node cli.js" } }),
    );
    const project = await detectRepositoryProject(
      { repoUrl: "https://github.com/example/clitool", sourcePath: root },
      {},
    );
    expect(project.projectType).toBe("cli");
    expect(project.previewAvailable).toBe(false);
  });

  it("detects a library via published entry points without app scripts", async () => {
    const root = await scratch();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "lib", main: "index.js", scripts: { test: "vitest" } }),
    );
    const project = await detectRepositoryProject(
      { repoUrl: "https://github.com/example/lib", sourcePath: root },
      {},
    );
    expect(project.projectType).toBe("library");
    expect(project.previewAvailable).toBe(false);
  });

  it("keeps Vite apps fully previewable", async () => {
    const root = await scratch();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "app", scripts: { dev: "vite" }, dependencies: { react: "18" }, devDependencies: { vite: "5" } }),
    );
    const project = await detectRepositoryProject(
      { repoUrl: "https://github.com/example/app", sourcePath: root },
      {},
    );
    expect(project.projectType).toBe("frontend");
    expect(project.previewAvailable).toBe(true);
    expect(project.previewCandidates[0]).toMatchObject({ root: ".", framework: "vite", available: true });
  });
});
