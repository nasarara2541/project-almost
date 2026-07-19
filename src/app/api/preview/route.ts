import { NextResponse } from "next/server";
import path from "node:path";
import { analysisSessionManager } from "@/lib/analyzer/analysis-session-manager";
import { fetchPublicGitHubRepository, RemoteRepositoryError } from "@/lib/analyzer/github-source";
import { detectRepositoryProject } from "@/lib/analyzer/project-detector";
import {
  packageRepositoryFiles,
  PreviewPackagingError,
  selectDevCommand,
} from "@/lib/preview/file-packager";
import { findAllowedRepository, RepositoryValidationError } from "@/lib/preview/repositories";
import type { PreviewBundle, PreviewFile, SupportedFramework } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns everything the browser needs to run the repository inside a
 * WebContainer: the source files plus the dev command. The server no longer
 * builds or spawns anything, which makes this endpoint stateless and fully
 * compatible with serverless deployment (Vercel).
 *
 * Resolution order:
 * 1. Use the in-memory analysis record when this serverless instance has it.
 * 2. Otherwise fall back to `repoUrl` in the body and fetch the repository
 *    fresh (bundled demo fixtures resolve from disk). This keeps previews
 *    working even when the analyze and preview requests land on different
 *    serverless instances.
 */
export async function POST(request: Request) {
  let cleanup: () => Promise<void> = async () => undefined;

  try {
    const body = (await request.json()) as {
      analysisId?: unknown;
      projectRoot?: unknown;
      repoUrl?: unknown;
    };
    if (body.projectRoot !== undefined && typeof body.projectRoot !== "string") {
      return NextResponse.json({ error: "projectRoot must be a string." }, { status: 400 });
    }
    const requestedRoot = typeof body.projectRoot === "string" ? body.projectRoot : undefined;

    let repoUrl: string | null = null;
    let sourcePath: string | null = null;
    let framework: SupportedFramework | null = null;
    let root = requestedRoot ?? ".";

    if (typeof body.analysisId === "string" && body.analysisId.trim()) {
      const resolved = analysisSessionManager.resolvePreviewRepository(
        body.analysisId,
        requestedRoot,
      );
      if (resolved) {
        repoUrl = resolved.repoUrl;
        sourcePath = resolved.sourcePath;
        framework = resolved.framework;
        root = resolved.root;
      }
    }

    if (!sourcePath) {
      if (typeof body.repoUrl !== "string" || !body.repoUrl.trim()) {
        return NextResponse.json(
          { error: "Provide an analysisId from a current analysis or a repoUrl." },
          { status: 400 },
        );
      }

      const fixture = findAllowedRepository(body.repoUrl);
      let basePath: string;
      if (fixture) {
        repoUrl = fixture.repoUrl;
        basePath = fixture.sourcePath;
      } else {
        const fetched = await fetchPublicGitHubRepository(body.repoUrl);
        cleanup = fetched.cleanup;
        repoUrl = fetched.repository.repoUrl;
        basePath = fetched.repository.sourcePath;
      }

      const project = await detectRepositoryProject(
        { repoUrl, sourcePath: basePath },
        { verifiedLocal: Boolean(fixture) },
      );
      const candidates = project.previewCandidates.filter((candidate) => candidate.available);
      const candidate = requestedRoot
        ? candidates.find((item) => item.root === requestedRoot)
        : candidates[0];
      if (!candidate) {
        return NextResponse.json(
          { error: project.previewReason || "No runnable React, Next.js, or Vite project was found." },
          { status: 409 },
        );
      }
      framework = candidate.framework as SupportedFramework;
      root = candidate.root;
      sourcePath =
        candidate.root === "." ? basePath : path.resolve(basePath, candidate.root);
      const resolvedBase = path.resolve(basePath);
      if (sourcePath !== resolvedBase && !sourcePath.startsWith(`${resolvedBase}${path.sep}`)) {
        return NextResponse.json({ error: "Invalid project root." }, { status: 400 });
      }
    }

    if (!repoUrl || !sourcePath || !framework) {
      return NextResponse.json(
        { error: "Analysis available; live preview unavailable for this repository or subproject." },
        { status: 409 },
      );
    }

    const files: PreviewFile[] = await packageRepositoryFiles(sourcePath);
    const packageManifest = files.find((file) => file.path === "package.json");
    const scripts = packageManifest
      ? Object.keys(
          (JSON.parse(packageManifest.contents) as { scripts?: Record<string, string> }).scripts ?? {},
        )
      : [];
    const devCommand = selectDevCommand(scripts);
    if (!devCommand) {
      return NextResponse.json(
        { error: "The project has no dev, start, serve, or preview npm script to run." },
        { status: 409 },
      );
    }

    const bundle: PreviewBundle = { repoUrl, projectRoot: root, framework, devCommand, files };
    return NextResponse.json(bundle, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (error instanceof RepositoryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof RemoteRepositoryError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof PreviewPackagingError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json(
      { error: "The preview bundle could not be created." },
      { status: 500 },
    );
  } finally {
    await cleanup();
  }
}
