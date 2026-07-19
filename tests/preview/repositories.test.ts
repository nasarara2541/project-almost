import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_FIXTURE_REPO_URL,
  DIGITALOCEAN_SAMPLE_REPO_URL,
  RepositoryValidationError,
  getAllowedRepositories,
  normalizeGitHubRepositoryUrl,
} from "../../src/lib/preview/repositories";

describe("GitHub repository validation", () => {
  it.each([
    ["https://github.com/Owner/Repo.git/", "https://github.com/owner/repo"],
    ["http://github.com/Owner/Repo", "https://github.com/owner/repo"],
    ["https://www.github.com/Owner/Repo/", "https://github.com/owner/repo"],
    ["github.com/Owner/Repo", "https://github.com/owner/repo"],
    ["https://github.com/Owner/Repo/tree/main", "https://github.com/owner/repo"],
    ["https://github.com/Owner/Repo/blob/main/src/app.ts", "https://github.com/owner/repo"],
    ["https://github.com/Owner/Repo?tab=readme-ov-file", "https://github.com/owner/repo"],
  ])("normalizes common GitHub URL form %s", (input, expected) => {
    expect(normalizeGitHubRepositoryUrl(input)).toBe(expected);
  });

  it.each([
    "https://gitlab.com/owner/repo",
    "https://token@github.com/owner/repo",
    "https://github.com/owner-only",
    "not a url at all",
  ])("rejects unsupported URL %s", (url) => {
    expect(() => normalizeGitHubRepositoryUrl(url)).toThrow(RepositoryValidationError);
  });
});

describe("bundled demo fixtures", () => {
  it("resolves the bundled fixture from local files", () => {
    const fixtures = getAllowedRepositories("/project");
    const repository = fixtures.find((item) => item.repoUrl === BUNDLED_FIXTURE_REPO_URL)!;
    expect(repository.source).toBe("bundled");
    expect(repository.sourcePath).toBe(path.join("/project", "fixtures", "sample-repo"));
  });

  it("maps the exact DigitalOcean URL to its pinned local fixture", () => {
    const repositories = getAllowedRepositories("/project");
    expect(repositories).toHaveLength(2);
    expect(repositories.find((item) => item.repoUrl === DIGITALOCEAN_SAMPLE_REPO_URL)).toMatchObject({
      source: "configured",
      sourcePath: path.join(
        "/project",
        "fixtures",
        "verified",
        "digitalocean-sample-vite-react",
      ),
    });
  });

  it("does not treat arbitrary public repositories as fixtures (they are fetched instead)", () => {
    const repositories = getAllowedRepositories("/project");
    expect(
      repositories.some((item) => item.repoUrl === "https://github.com/example/untrusted"),
    ).toBe(false);
  });
});
