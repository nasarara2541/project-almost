import path from "node:path";
import {
  BUNDLED_FIXTURE_REPO_URL,
  DIGITALOCEAN_SAMPLE_REPO_URL,
} from "./constants";

export {
  BUNDLED_FIXTURE_REPO_URL,
  DIGITALOCEAN_SAMPLE_REPO_SHA,
  DIGITALOCEAN_SAMPLE_REPO_URL,
} from "./constants";

export type AllowedRepository = {
  repoUrl: string;
  sourcePath: string;
  source: "bundled" | "configured";
};

export class RepositoryValidationError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_URL" | "NOT_ALLOWED" | "INVALID_CONFIGURATION",
  ) {
    super(message);
    this.name = "RepositoryValidationError";
  }
}

/**
 * Accepts the common ways people paste a GitHub repository URL (http or
 * https, an optional www. prefix, a missing scheme, trailing slashes, a
 * trailing .git, and deep links such as /tree/<branch>, /blob/<path>,
 * /issues, or /pulls) and canonicalizes all of them to
 * `https://github.com/<owner>/<repository>`.
 */
export function normalizeGitHubRepositoryUrl(input: string): string {
  let candidate = input.trim();
  if (candidate && !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new RepositoryValidationError(
      "Enter a valid GitHub repository URL.",
      "INVALID_URL",
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    hostname !== "github.com" ||
    url.username ||
    url.password
  ) {
    throw new RepositoryValidationError(
      "Only github.com repository URLs are supported.",
      "INVALID_URL",
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new RepositoryValidationError(
      "Use a repository URL in the form https://github.com/owner/repository.",
      "INVALID_URL",
    );
  }

  const [owner, rawRepository] = segments;
  const repository = rawRepository.replace(/\.git$/i, "");
  const validSegment = /^[a-zA-Z0-9_.-]+$/;

  if (!owner || !repository || !validSegment.test(owner) || !validSegment.test(repository)) {
    throw new RepositoryValidationError(
      "The GitHub owner or repository name is invalid.",
      "INVALID_URL",
    );
  }

  return `https://github.com/${owner.toLowerCase()}/${repository.toLowerCase()}`;
}

/**
 * Bundled demo repositories that resolve from local fixtures instead of the
 * GitHub API. This is NOT an allowlist: any supported repository can be
 * audited when RepoLens has access. These fixtures keep the demo instant and available offline.
 */
export function getAllowedRepositories(
  projectRoot = process.cwd(),
): AllowedRepository[] {
  return [
    {
      repoUrl: BUNDLED_FIXTURE_REPO_URL,
      sourcePath: path.join(/*turbopackIgnore: true*/ projectRoot, "fixtures", "sample-repo"),
      source: "bundled",
    },
    {
      repoUrl: DIGITALOCEAN_SAMPLE_REPO_URL,
      sourcePath: path.join(
        /*turbopackIgnore: true*/ projectRoot,
        "fixtures",
        "verified",
        "digitalocean-sample-vite-react",
      ),
      source: "configured",
    },
  ];
}

export function findAllowedRepository(
  input: string,
  projectRoot = process.cwd(),
): AllowedRepository | null {
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeGitHubRepositoryUrl(input);
  } catch {
    return null;
  }
  return (
    getAllowedRepositories(projectRoot).find((candidate) => candidate.repoUrl === normalizedUrl) ?? null
  );
}
