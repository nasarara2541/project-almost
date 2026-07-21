import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeGitHubRepositoryUrl } from "../preview/repositories";
import type { SkippedRepositoryFile } from "../../types/api";
import type { AnalysisRepository } from "./repository-analyzer";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
// Additional text files used for repository auditing, interface reconstruction,
// and detection of non-JavaScript project types.
const RUNTIME_TEXT_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
  ".svg",
  ".vue",
  ".svelte",
  ".astro",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".env.example",
  ".py",
  // Other common languages, fetched so language breakdown, folder structure,
  // and architecture context work for CLI/backend/library/data repositories.
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cs",
  ".sh",
  ".ipynb",
]);
// Small binary assets (logos, icons, fonts) that static previews commonly need.
const RUNTIME_BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
]);
const MAX_BINARY_FILE_BYTES = 512 * 1024;
const MANIFEST_FILES = new Set([
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "bun.lock",
  "bun.lockb",
  "turbo.json",
  "nx.json",
  // Non-JavaScript / extension project manifests used by project detection.
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  "manifest.json",
  ".nvmrc",
  // Backend/library manifests used for classification and overview.
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "Dockerfile",
  "Makefile",
  // Community-health files commonly have no extension or live at the root.
  "LICENSE",
  "LICENCE",
  "COPYING",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CHANGELOG.md",
]);
const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

type GitHubRepositoryResponse = {
  private?: boolean;
  default_branch?: string;
  description?: string | null;
  full_name?: string;
  archived?: boolean;
  pushed_at?: string;
  open_issues_count?: number;
};

type GitHubBranchResponse = { commit?: { sha?: string } };

type GitHubTreeEntry = {
  path?: string;
  sha?: string;
  mode?: string;
  type?: string;
  size?: number;
};

type GitHubTreeResponse = {
  truncated?: boolean;
  tree?: GitHubTreeEntry[];
};

type GitHubBlobResponse = {
  content?: string;
  encoding?: string;
  size?: number;
};

type GitHubPullRequestResponse = {
  number?: number;
  title?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  draft?: boolean;
};

export type RemoteRepositoryErrorCode =
  | "NOT_FOUND"
  | "NOT_PUBLIC"
  | "NOT_AUTHORIZED"
  | "RATE_LIMITED"
  | "EMPTY_REPOSITORY"
  | "TOO_LARGE"
  | "FETCH_FAILED";

export class RemoteRepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: RemoteRepositoryErrorCode,
  ) {
    super(message);
    this.name = "RemoteRepositoryError";
  }
}

const REMOTE_ERROR_CODES = new Set<RemoteRepositoryErrorCode>([
  "NOT_FOUND",
  "NOT_PUBLIC",
  "NOT_AUTHORIZED",
  "RATE_LIMITED",
  "EMPTY_REPOSITORY",
  "TOO_LARGE",
  "FETCH_FAILED",
]);

/** Works across Next.js development-module reload boundaries where instanceof can be unreliable. */
export function isRemoteRepositoryError(error: unknown): error is RemoteRepositoryError {
  if (error instanceof RemoteRepositoryError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown };
  return candidate.name === "RemoteRepositoryError"
    && typeof candidate.message === "string"
    && REMOTE_ERROR_CODES.has(candidate.code as RemoteRepositoryErrorCode);
}

export type FetchedGitHubRepository = {
  repository: AnalysisRepository;
  defaultBranch: string;
  description?: string;
  private: boolean;
  cleanup: () => Promise<void>;
};

function repositoryParts(repoUrl: string): { owner: string; repo: string; normalized: string } {
  const normalized = normalizeGitHubRepositoryUrl(repoUrl);
  const url = new URL(normalized);
  const [owner, repo] = url.pathname.split("/").filter(Boolean);
  return { owner, repo, normalized };
}

function apiHeaders(accessToken?: string): HeadersInit {
  const token = accessToken?.trim() || process.env.GITHUB_TOKEN?.trim();
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "RepoLens-readonly-analyzer",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson<T>(
  url: string,
  fetcher: typeof fetch,
  accessToken?: string,
  notFound?: { message: string; code: RemoteRepositoryErrorCode },
): Promise<T> {
  const response = await fetcher(url, {
    headers: apiHeaders(accessToken),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 404) {
      if (notFound) throw new RemoteRepositoryError(notFound.message, notFound.code);
      throw new RemoteRepositoryError(
        accessToken
          ? "The repository was not found, or RepoLens is not installed for it."
          : "The public GitHub repository was not found.",
        "NOT_FOUND",
      );
    }
    if (response.status === 401 || (response.status === 403 && accessToken && response.headers.get("x-ratelimit-remaining") !== "0")) {
      throw new RemoteRepositoryError(
        "RepoLens does not have read access to this repository. Install the GitHub App for the repository and try again.",
        "NOT_AUTHORIZED",
      );
    }
    if (response.status === 403 || response.status === 429) {
      throw new RemoteRepositoryError(
        "GitHub API rate limit reached. Configure GITHUB_TOKEN or try again later.",
        "RATE_LIMITED",
      );
    }
    throw new RemoteRepositoryError(
      `GitHub returned HTTP ${response.status} while reading the repository.`,
      "FETCH_FAILED",
    );
  }
  return (await response.json()) as T;
}

function safeRelevantPath(entry: GitHubTreeEntry): entry is GitHubTreeEntry & { path: string; size: number } {
  if (
    entry.type !== "blob" ||
    !["100644", "100755"].includes(entry.mode ?? "") ||
    typeof entry.path !== "string" ||
    typeof entry.size !== "number"
  ) return false;
  const normalized = path.posix.normalize(entry.path);
  if (
    normalized !== entry.path ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.includes("\\")
  ) return false;
  // Skip directories that never matter and can be enormous.
  if (/(^|\/)(node_modules|\.git|dist|build|\.next|coverage|__pycache__)\//.test(normalized)) {
    return false;
  }
  const basename = path.posix.basename(normalized);
  const extension = path.posix.extname(basename).toLowerCase();
  if (basename.startsWith(".env") && basename !== ".env.example") return false;
  if (RUNTIME_BINARY_EXTENSIONS.has(extension)) return true;
  if (/^(?:readme|licen[cs]e|copying|contributing|code[_-]of[_-]conduct|security|changelog)(?:\.|$)/i.test(basename)) {
    return true;
  }
  return (
    MANIFEST_FILES.has(basename) ||
    SOURCE_EXTENSIONS.has(extension) ||
    RUNTIME_TEXT_EXTENSIONS.has(extension)
  );
}

function isBinaryPath(filePath: string): boolean {
  return RUNTIME_BINARY_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase());
}

function encodePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

async function fetchOpenPullRequestContext(
  apiBase: string,
  fetcher: typeof fetch,
  accessToken?: string,
  privateRepository = false,
): Promise<Pick<NonNullable<AnalysisRepository["activity"]>, "openPullRequests" | "pullRequestScan">> {
  try {
    const url = `${apiBase}/pulls?state=open&sort=updated&direction=desc&per_page=100`;
    const requestPulls = (token?: string) => fetcher(url, {
      headers: apiHeaders(token),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    let response = await requestPulls(accessToken);
    if (!response.ok && accessToken && !privateRepository) response = await requestPulls();
    if (!response.ok) return { openPullRequests: [], pullRequestScan: "unavailable" };
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) return { openPullRequests: [], pullRequestScan: "unavailable" };
    const openPullRequests = (payload as GitHubPullRequestResponse[])
      .filter((item): item is GitHubPullRequestResponse & { number: number; title: string; html_url: string } =>
        typeof item.number === "number" && typeof item.title === "string" && typeof item.html_url === "string",
      )
      .map((item) => ({
        number: item.number,
        title: item.title,
        url: item.html_url,
        createdAt: item.created_at ?? "",
        updatedAt: item.updated_at ?? "",
        draft: Boolean(item.draft),
      }));
    return {
      openPullRequests,
      pullRequestScan: response.headers.get("link")?.includes('rel="next"') ? "partial" : "complete",
    };
  } catch {
    return { openPullRequests: [], pullRequestScan: "unavailable" };
  }
}

export async function fetchPublicGitHubRepository(
  repoUrl: string,
  fetcher: typeof fetch = fetch,
  accessToken?: string,
  commitShaOverride?: string,
): Promise<FetchedGitHubRepository> {
  const { owner, repo, normalized } = repositoryParts(repoUrl);
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const metadata = await githubJson<GitHubRepositoryResponse>(apiBase, fetcher, accessToken);
  if (metadata.private && !accessToken) {
    throw new RemoteRepositoryError("Connect GitHub to analyze a private repository.", "NOT_AUTHORIZED");
  }
  if (!metadata.default_branch) {
    throw new RemoteRepositoryError("The repository has no readable default branch.", "FETCH_FAILED");
  }

  const pullRequestContext = commitShaOverride || metadata.archived
    ? { openPullRequests: [], pullRequestScan: "not-needed" as const }
    : metadata.open_issues_count === 0
      ? { openPullRequests: [], pullRequestScan: "complete" as const }
      : typeof metadata.open_issues_count === "number"
        ? await fetchOpenPullRequestContext(apiBase, fetcher, accessToken, Boolean(metadata.private))
        : { openPullRequests: [], pullRequestScan: "unavailable" as const };

  const branch = commitShaOverride ? null : await githubJson<GitHubBranchResponse>(
    `${apiBase}/branches/${encodeURIComponent(metadata.default_branch)}`,
    fetcher,
    accessToken,
    {
      message: "This repository has no readable commits yet. Add an initial file such as README.md, commit it on GitHub, then analyze the repository again.",
      code: "EMPTY_REPOSITORY",
    },
  );
  const commitSha = commitShaOverride?.trim() || branch?.commit?.sha;
  if (!commitSha) throw new RemoteRepositoryError("The default branch commit could not be resolved.", "FETCH_FAILED");
  const tree = await githubJson<GitHubTreeResponse>(
    `${apiBase}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
    fetcher,
    accessToken,
  );
  if (tree.truncated) {
    throw new RemoteRepositoryError(
      "The repository tree exceeds GitHub's recursive tree limit and cannot be analyzed completely.",
      "TOO_LARGE",
    );
  }

  const repositoryFiles = (tree.tree ?? []).filter((entry) => entry.type === "blob").length;
  const supportedFiles = (tree.tree ?? []).filter(safeRelevantPath);
  const skippedFiles: SkippedRepositoryFile[] = supportedFiles
    .filter((file) => file.size > MAX_FILE_BYTES)
    .map((file) => ({ path: file.path, size: file.size, reason: "oversized" as const }));
  const files = supportedFiles.filter((file) => file.size <= MAX_FILE_BYTES);
  if (files.length > MAX_FILES) {
    throw new RemoteRepositoryError(
      `Repository has ${files.length} supported files; the read-only analysis limit is ${MAX_FILES}.`,
      "TOO_LARGE",
    );
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new RemoteRepositoryError(
      "Supported source exceeds the 20 MB total fetch limit.",
      "TOO_LARGE",
    );
  }

  const workspace = await mkdtemp(
    /* turbopackIgnore: true */ path.join(tmpdir(), "repolens-analysis-"),
  );
  try {
    let cursor = 0;
    let fetchedFiles = 0;
    const workers = Array.from({ length: Math.min(8, files.length) }, async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        let bytes: Buffer;
        if (metadata.private) {
          if (!file.sha) {
            skippedFiles.push({ path: file.path, size: file.size, reason: "fetch-failed" });
            continue;
          }
          const blob = await githubJson<GitHubBlobResponse>(
            `${apiBase}/git/blobs/${encodeURIComponent(file.sha)}`,
            fetcher,
            accessToken,
          );
          if (blob.encoding !== "base64" || typeof blob.content !== "string") {
            skippedFiles.push({ path: file.path, size: file.size, reason: "fetch-failed" });
            continue;
          }
          bytes = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
        } else {
          const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(commitSha)}/${encodePath(file.path)}`;
          const response = await fetcher(rawUrl, {
            headers: { "User-Agent": "RepoLens-readonly-analyzer" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!response.ok) {
            skippedFiles.push({ path: file.path, size: file.size, reason: "fetch-failed" });
            continue;
          }
          bytes = Buffer.from(await response.arrayBuffer());
        }
        if (isBinaryPath(file.path)) {
          // Binary assets (logos, fonts) are best-effort: a missing image
          // should not fail the whole analysis or preview.
          if (bytes.byteLength > MAX_BINARY_FILE_BYTES) {
            skippedFiles.push({ path: file.path, size: bytes.byteLength, reason: "oversized" });
            continue;
          }
          const destination = path.join(/* turbopackIgnore: true */ workspace, ...file.path.split("/"));
          await mkdir(/* turbopackIgnore: true */ path.dirname(destination), { recursive: true });
          await writeFile(/* turbopackIgnore: true */ destination, bytes);
          fetchedFiles += 1;
        } else {
          const destination = path.join(/* turbopackIgnore: true */ workspace, ...file.path.split("/"));
          await mkdir(/* turbopackIgnore: true */ path.dirname(destination), { recursive: true });
          const source = bytes.toString("utf8");
          if (Buffer.byteLength(source) > MAX_FILE_BYTES) {
            // GitHub tree metadata can race with raw-content responses when a
            // branch moves. Keep the per-file limit without failing the rest
            // of the repository if the fetched content is unexpectedly large.
            skippedFiles.push({
              path: file.path,
              size: Buffer.byteLength(source),
              reason: "oversized",
            });
            continue;
          }
          await writeFile(/* turbopackIgnore: true */ destination, source, "utf8");
          fetchedFiles += 1;
        }
      }
    });
    await Promise.all(workers);
    if (fetchedFiles === 0 && files.length > 0) {
      throw new RemoteRepositoryError(
        "GitHub source files could not be fetched for analysis.",
        "FETCH_FAILED",
      );
    }
    return {
      repository: {
        repoUrl: normalized,
        sourcePath: workspace,
        activity: {
          archived: Boolean(metadata.archived),
          pushedAt: metadata.pushed_at,
          openIssueCount: metadata.open_issues_count,
          ...pullRequestContext,
        },
        acquisition: {
          repositoryFiles,
          supportedFiles: supportedFiles.length,
          fetchedFiles,
          skippedFiles: skippedFiles.sort((a, b) => a.path.localeCompare(b.path)),
        },
      },
      defaultBranch: metadata.default_branch,
      description: metadata.description ?? undefined,
      private: Boolean(metadata.private),
      cleanup: () => rm(/* turbopackIgnore: true */ workspace, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(/* turbopackIgnore: true */ workspace, { recursive: true, force: true });
    if (isRemoteRepositoryError(error)) throw error;
    throw new RemoteRepositoryError(
      error instanceof Error ? error.message : "Repository source could not be fetched.",
      "FETCH_FAILED",
    );
  }
}
