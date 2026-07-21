import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisSessionManager } from "../../src/lib/analyzer/analysis-session-manager";
import {
  fetchPublicGitHubRepository,
  isRemoteRepositoryError,
} from "../../src/lib/analyzer/github-source";
import { detectRepositoryProject } from "../../src/lib/analyzer/project-detector";
import { BUNDLED_FIXTURE_REPO_URL } from "../../src/lib/preview/constants";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createMonorepo() {
  const root = await mkdtemp(path.join(tmpdir(), "repolens-monorepo-test-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "apps", "web"), { recursive: true });
  await mkdir(path.join(root, "packages", "ui"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "workspace", private: true, workspaces: ["apps/*", "packages/*"] }),
  );
  await writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n");
  await writeFile(
    path.join(root, "apps", "web", "package.json"),
    JSON.stringify({
      name: "web",
      scripts: { dev: "vite", build: "vite build" },
      dependencies: { react: "latest", vite: "latest" },
    }),
  );
  await writeFile(
    path.join(root, "packages", "ui", "package.json"),
    JSON.stringify({ name: "ui", dependencies: { react: "latest" } }),
  );
  return root;
}

describe("generic project detection", () => {
  it("recognizes a Markdown link collection as a curated catalog", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "repolens-catalog-test-"));
    temporaryRoots.push(root);
    const links = Array.from(
      { length: 30 },
      (_, index) => `- [Project ${index}](https://github.com/example/project-${index})`,
    ).join("\n");
    await writeFile(path.join(root, "README.md"), `# Android projects\n\n${links}\n`);
    await writeFile(path.join(root, "LICENSE"), "Apache License 2.0");

    const project = await detectRepositoryProject(
      { repoUrl: "https://github.com/example/catalog", sourcePath: root },
      { defaultBranch: "main" },
    );

    expect(project.projectType).toBe("catalog");
  });

  it("detects monorepos, package managers, frameworks, and runnable roots", async () => {
    const sourcePath = await createMonorepo();
    const project = await detectRepositoryProject(
      { repoUrl: "https://github.com/example/monorepo", sourcePath },
      { verifiedLocal: false, defaultBranch: "main" },
    );

    expect(project).toMatchObject({
      projectType: "monorepo",
      monorepo: true,
      source: "github-readonly",
      defaultBranch: "main",
    });
    expect(project.frameworks).toEqual(expect.arrayContaining(["vite", "react"]));
    expect(project.packageManagers).toContain("pnpm");
    expect(project.subprojects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ root: "apps/web", framework: "vite", runnable: true }),
        expect.objectContaining({ root: "packages/ui", framework: "react", runnable: false }),
      ]),
    );
  });

  it("produces an audit for the bundled fixture", async () => {
    const manager = new AnalysisSessionManager(60_000);
    const result = await manager.create(BUNDLED_FIXTURE_REPO_URL);
    expect(result.audit.coverage.fetchedFiles).toBeGreaterThan(0);
    expect(result.audit.findings.length).toBeGreaterThan(0);
    await manager.dispose();
  });
});

describe("read-only GitHub source acquisition", () => {
  it("collects open pull-request context without making it a hard dependency", async () => {
    const readme = "# Catalog\n";
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/repos/example/catalog")) {
        return Response.json({
          private: false,
          default_branch: "main",
          pushed_at: "2026-03-25T01:04:16Z",
          open_issues_count: 1,
        });
      }
      if (url.includes("/pulls?")) {
        return Response.json([{
          number: 12,
          title: "Update README links",
          html_url: "https://github.com/example/catalog/pull/12",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-02-01T00:00:00Z",
          draft: false,
        }]);
      }
      if (url.includes("/branches/main")) return Response.json({ commit: { sha: "catalog123" } });
      if (url.includes("/git/trees/catalog123")) {
        return Response.json({
          truncated: false,
          tree: [{ path: "README.md", mode: "100644", type: "blob", size: readme.length }],
        });
      }
      if (url.endsWith("/README.md")) return new Response(readme);
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const fetched = await fetchPublicGitHubRepository("https://github.com/example/catalog", fetcher);
    temporaryRoots.push(fetched.repository.sourcePath);

    expect(fetched.repository.activity).toMatchObject({
      pushedAt: "2026-03-25T01:04:16Z",
      pullRequestScan: "complete",
      openPullRequests: [{ number: 12, title: "Update README links" }],
    });
    await fetched.cleanup();
  });

  it("explains when an accessible repository has no first commit", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/repos/example/empty")) {
        return Response.json({ private: true, default_branch: "main" });
      }
      if (url.includes("/branches/main")) return new Response("not found", { status: 404 });
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(fetchPublicGitHubRepository(
      "https://github.com/example/empty",
      fetcher,
      "github-user-token",
    )).rejects.toMatchObject({
      code: "EMPTY_REPOSITORY",
      message: expect.stringContaining("initial file"),
    });
  });

  it("recognizes serialized remote errors across development reload boundaries", () => {
    expect(isRemoteRepositoryError({
      name: "RemoteRepositoryError",
      message: "Empty repository",
      code: "EMPTY_REPOSITORY",
    })).toBe(true);
    expect(isRemoteRepositoryError({ name: "RemoteRepositoryError", code: "UNKNOWN" })).toBe(false);
  });

  it("reads an installed private repository through authenticated Git blob requests", async () => {
    const source = "export const privateValue = true;";
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (!headers.get("Authorization")) return new Response("missing auth", { status: 401 });
      if (url.endsWith("/repos/example/private-repo")) {
        return Response.json({ private: true, default_branch: "main" });
      }
      if (url.includes("/branches/main")) return Response.json({ commit: { sha: "private123" } });
      if (url.includes("/git/trees/private123")) {
        return Response.json({
          truncated: false,
          tree: [{ path: "src/private.ts", sha: "blob123", mode: "100644", type: "blob", size: source.length }],
        });
      }
      if (url.includes("/git/blobs/blob123")) {
        return Response.json({ encoding: "base64", content: Buffer.from(source).toString("base64"), size: source.length });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const fetched = await fetchPublicGitHubRepository(
      "https://github.com/example/private-repo",
      fetcher,
      "github-user-token",
    );
    temporaryRoots.push(fetched.repository.sourcePath);

    expect(fetched.private).toBe(true);
    expect(await readFile(path.join(fetched.repository.sourcePath, "src", "private.ts"), "utf8"))
      .toBe(source);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await fetched.cleanup();
  });

  it("fetches metadata, a complete tree, manifests, and supported source without execution", async () => {
    const packageSource = JSON.stringify({
      name: "remote-app",
      scripts: { dev: "vite" },
      dependencies: { react: "latest", vite: "latest" },
    });
    const appSource = "export function App() { return <main>Remote</main>; }";
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/repos/example/remote")) {
        return Response.json({ private: false, default_branch: "main", description: "Remote" });
      }
      if (url.includes("/branches/main")) return Response.json({ commit: { sha: "abc123" } });
      if (url.includes("/git/trees/abc123")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "package.json", mode: "100644", type: "blob", size: packageSource.length },
            { path: "src/App.tsx", mode: "100644", type: "blob", size: appSource.length },
            { path: "image.png", mode: "100644", type: "blob", size: 50 },
          ],
        });
      }
      if (url.endsWith("/package.json")) return new Response(packageSource);
      if (url.endsWith("/src/App.tsx")) return new Response(appSource);
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const fetched = await fetchPublicGitHubRepository(
      "https://github.com/example/remote",
      fetcher,
    );
    temporaryRoots.push(fetched.repository.sourcePath);
    expect(fetched.defaultBranch).toBe("main");
    expect(await readFile(path.join(fetched.repository.sourcePath, "src", "App.tsx"), "utf8")).toBe(
      appSource,
    );
    expect(await stat(path.join(fetched.repository.sourcePath, "image.png")).catch(() => null)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(6); // metadata, branch, tree, 2 sources, 1 best-effort asset
    await fetched.cleanup();
  });

  it("analyzes an exact pull-request commit without resolving the default branch", async () => {
    const source = "export const exactCommit = true;";
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/repos/example/exact")) {
        return Response.json({ private: false, default_branch: "main" });
      }
      if (url.includes("/branches/")) return new Response("branch lookup must not happen", { status: 500 });
      if (url.includes("/git/trees/pr-head-123")) {
        return Response.json({
          truncated: false,
          tree: [{ path: "src/exact.ts", mode: "100644", type: "blob", size: source.length }],
        });
      }
      if (url.includes("/pr-head-123/src/exact.ts")) return new Response(source);
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const fetched = await fetchPublicGitHubRepository(
      "https://github.com/example/exact",
      fetcher,
      undefined,
      "pr-head-123",
    );
    temporaryRoots.push(fetched.repository.sourcePath);
    expect(await readFile(path.join(fetched.repository.sourcePath, "src", "exact.ts"), "utf8"))
      .toBe(source);
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining("/branches/"), expect.anything());
    await fetched.cleanup();
  });

  it("skips oversized files instead of rejecting the whole repository", async () => {
    const packageSource = JSON.stringify({ name: "remote-app" });
    const oversizedPath = "dist-like/generated-bundle.js";
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/repos/example/remote")) {
        return Response.json({ private: false, default_branch: "main" });
      }
      if (url.includes("/branches/main")) return Response.json({ commit: { sha: "abc123" } });
      if (url.includes("/git/trees/abc123")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "package.json", mode: "100644", type: "blob", size: packageSource.length },
            { path: oversizedPath, mode: "100644", type: "blob", size: 512 * 1024 + 1 },
          ],
        });
      }
      if (url.endsWith("/package.json")) return new Response(packageSource);
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const fetched = await fetchPublicGitHubRepository("https://github.com/example/remote", fetcher);
    temporaryRoots.push(fetched.repository.sourcePath);
    expect(await readFile(path.join(fetched.repository.sourcePath, "package.json"), "utf8")).toBe(
      packageSource,
    );
    expect(await stat(path.join(fetched.repository.sourcePath, oversizedPath)).catch(() => null)).toBeNull();
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining(oversizedPath), expect.anything());
    await fetched.cleanup();
  });
});
