import { describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/preview/route";
import { BUNDLED_FIXTURE_REPO_URL } from "../../src/lib/preview/constants";

describe("POST /api/preview (stateless bundle endpoint)", () => {
  it("returns a runnable WebContainer bundle for the bundled fixture via repoUrl fallback", async () => {
    const response = await POST(
      new Request("http://localhost/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: BUNDLED_FIXTURE_REPO_URL }),
      }),
    );
    expect(response.status).toBe(200);
    const bundle = (await response.json()) as {
      framework: string;
      devCommand: { args: string[] };
      files: Array<{ path: string }>;
    };
    expect(bundle.framework).toBe("vite");
    expect(bundle.devCommand.args[0]).toBe("run");
    const paths = bundle.files.map((file) => file.path);
    expect(paths).toContain("package.json");
    expect(paths).toContain("index.html");
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
  });

  it("rejects a request with neither analysisId nor repoUrl", async () => {
    const response = await POST(
      new Request("http://localhost/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
  });
});
