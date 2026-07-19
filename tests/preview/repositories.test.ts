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
  it("normalizes a public repository root URL", () => {
    expect(normalizeGitHubRepositoryUrl("https://github.com/Owner/Repo.git/"))
      .toBe("https://github.com/owner/repo");
  });

  it.each([
    "http://github.com/owner/repo",
    "https://gitlab.com/owner/repo",
    "https://github.com/owner/repo/tree/main",
    "https://token@github.com/owner/repo",
    "not-a-url",
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
