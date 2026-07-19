import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AnalysisSessionManager } from "../../src/lib/analyzer/analysis-session-manager";
import {
  extractControls,
  inferInterfaceRole,
  inventoryWorkspace,
} from "../../src/lib/analyzer/interface-detector";
import { detectRepositoryProject } from "../../src/lib/analyzer/project-detector";
import { analyzeRepository } from "../../src/lib/analyzer/repository-analyzer";
import { BUNDLED_FIXTURE_REPO_URL } from "../../src/lib/preview/constants";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function analyzeFixtureDirectory(sourcePath: string, repoUrl: string) {
  const repository = { repoUrl, sourcePath };
  const project = await detectRepositoryProject(repository);
  return analyzeRepository(repository, "interface-test", project);
}

describe("Chrome extension interface detection", () => {
  const extensionFixture = path.join(process.cwd(), "fixtures", "chrome-extension-demo");

  it("detects the popup and options screens with safe previews", async () => {
    const analysis = await analyzeFixtureDirectory(
      extensionFixture,
      "https://github.com/example/flex-extension",
    );

    expect(analysis.project.projectType).toBe("chrome-extension");
    expect(analysis.interface.hasVisualInterface).toBe(true);
    expect(analysis.interface.summary).toMatch(/chrome extension/i);

    const popup = analysis.interface.screens.find((screen) => screen.kind === "popup");
    expect(popup).toBeDefined();
    expect(popup!.file).toBe("popup.html");
    expect(popup!.name).toBe("Flex Scheduler");
    expect(popup!.previewHtml).toBeTruthy();
    // Popup scripts must never survive sanitization.
    expect(popup!.previewHtml).not.toMatch(/<script/i);
    // The popup stylesheet is inlined so the preview looks like the popup.
    expect(popup!.previewHtml).toContain("popup-header");
    // The extension icon is inlined as a data URI.
    expect(popup!.previewHtml).toContain("data:image/png;base64,");
    expect(popup!.styles).toContain("popup.css");
    expect(popup!.assets).toContain("icons/icon48.png");

    const options = analysis.interface.screens.find((screen) => screen.kind === "options");
    expect(options).toBeDefined();
    expect(options!.file).toBe("options.html");

    const contentScript = analysis.interface.screens.find((screen) => screen.kind === "content-script");
    expect(contentScript).toBeDefined();
  });

  it("lists popup controls and extension icons", async () => {
    const analysis = await analyzeFixtureDirectory(
      extensionFixture,
      "https://github.com/example/flex-extension",
    );
    const popup = analysis.interface.screens.find((screen) => screen.kind === "popup")!;

    expect(popup.controls.join("\n")).toMatch(/schedule block/i);
    expect(popup.controls.join("\n")).toMatch(/cancel all/i);
    expect(popup.controls.join("\n")).toMatch(/input \(time\)/i);
    expect(analysis.interface.icons.some((icon) => icon.includes("icons/icon16.png"))).toBe(true);
  });
});

describe("Frontend interface detection", () => {
  it("detects route screens with wireframe previews and typed components for the bundled fixture", async () => {
    const manager = new AnalysisSessionManager(60_000);
    const analysis = await manager.create(BUNDLED_FIXTURE_REPO_URL);

    expect(analysis.interface.hasVisualInterface).toBe(true);
    const routeScreens = analysis.interface.screens.filter((screen) => screen.kind === "route");
    expect(routeScreens.map((screen) => screen.route)).toEqual(
      expect.arrayContaining(["/", "/settings"]),
    );
    const settings = routeScreens.find((screen) => screen.route === "/settings")!;
    expect(settings.previewHtml).toBeTruthy();
    expect(settings.previewHtml).not.toMatch(/<script/i);
    expect(settings.location.file).toBe("src/pages/SettingsPage.tsx");
    expect(settings.location.functionName).toBe("SettingsPage");

    const components = analysis.interface.components;
    expect(components.map((component) => component.name)).toEqual(
      expect.arrayContaining(["MetricCard", "Toggle", "AppShell"]),
    );
    const card = components.find((component) => component.name === "MetricCard")!;
    expect(card.role).toBe("card");
    expect(card.file).toBe("src/components/MetricCard.tsx");

    expect(analysis.languages.map((language) => language.name)).toContain("TypeScript");
    expect(analysis.folders.length).toBeGreaterThan(0);
    expect(analysis.importantFiles).toContain("package.json");
    await manager.dispose();
  });
});

describe("Next.js + Tailwind dashboard templates", () => {
  it("detects app-router routes, Tailwind, and dashboard components", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "repolens-next-dash-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "src", "app", "dashboard"), { recursive: true });
    await mkdir(path.join(root, "src", "components"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "dashboard-landing-template",
        scripts: { dev: "next dev", build: "next build" },
        dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" },
        devDependencies: { tailwindcss: "4.0.0" },
      }),
    );
    await writeFile(path.join(root, "tailwind.config.ts"), "export default { content: [] };\n");
    await writeFile(
      path.join(root, "src", "app", "page.tsx"),
      `export default function LandingPage() {
        return (
          <main className="grid gap-8">
            <nav className="flex justify-between"><span>Acme</span><button>Sign in</button></nav>
            <h1 className="text-4xl">Ship dashboards faster</h1>
          </main>
        );
      }\n`,
    );
    await writeFile(
      path.join(root, "src", "app", "dashboard", "page.tsx"),
      `import { StatCard } from "../../components/StatCard";
      export default function DashboardPage() {
        return (
          <section className="grid grid-cols-3 gap-4">
            <StatCard label="Revenue" />
            <table><thead><tr><th>Order</th></tr></thead></table>
          </section>
        );
      }\n`,
    );
    await writeFile(
      path.join(root, "src", "components", "StatCard.tsx"),
      `export function StatCard({ label }: { label: string }) {
        return <div className="rounded-xl border p-4"><strong>{label}</strong></div>;
      }\n`,
    );

    const analysis = await analyzeFixtureDirectory(root, "https://github.com/example/dashboard-template");

    expect(analysis.project.projectType).toBe("frontend");
    expect(analysis.project.frameworks).toContain("next");
    expect(analysis.interface.tailwind).toBe(true);
    expect(analysis.routes).toEqual(expect.arrayContaining(["/", "/dashboard"]));

    const dashboard = analysis.interface.screens.find((screen) => screen.route === "/dashboard");
    expect(dashboard).toBeDefined();
    expect(dashboard!.previewHtml).toBeTruthy();
    expect(dashboard!.previewHtml).toContain('data-name="StatCard"');
    expect(dashboard!.previewHtml).not.toMatch(/<script/i);

    const statCard = analysis.interface.components.find((component) => component.name === "StatCard");
    expect(statCard?.role).toBe("card");
    expect(statCard?.previewHtml).toContain("rounded-xl");
  });
});

describe("Non-visual repositories", () => {
  it("does not fail and shows the no-visual-interface message for a Python CLI repo", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "repolens-python-cli-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "src", "analyzer"), { recursive: true });
    await writeFile(path.join(root, "pyproject.toml"), "[project]\nname = 'code-review-graph'\n");
    await writeFile(path.join(root, "requirements.txt"), "networkx\nclick\n");
    await writeFile(path.join(root, "src", "analyzer", "graph.py"), "def build_graph():\n    return {}\n");
    await writeFile(path.join(root, "README.md"), "# code-review-graph\n");

    const analysis = await analyzeFixtureDirectory(root, "https://github.com/example/code-review-graph");

    expect(analysis.project.projectType).toBe("python");
    expect(analysis.interface.hasVisualInterface).toBe(false);
    expect(analysis.interface.message).toBe(
      "No visual interface detected. This repository appears to be a CLI, library, backend, or data project.",
    );
    expect(analysis.interface.screens).toHaveLength(0);
    expect(analysis.languages.map((language) => language.name)).toContain("Python");
    expect(analysis.folders.join("\n")).toContain("src/analyzer/");
    expect(analysis.importantFiles).toEqual(
      expect.arrayContaining(["pyproject.toml", "requirements.txt"]),
    );
  });

  it("classifies Go repositories as backend projects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "repolens-go-"));
    temporaryRoots.push(root);
    await writeFile(path.join(root, "go.mod"), "module example.com/service\n");
    await writeFile(path.join(root, "main.go"), "package main\nfunc main() {}\n");

    const repository = { repoUrl: "https://github.com/example/service", sourcePath: root };
    const project = await detectRepositoryProject(repository);
    expect(project.projectType).toBe("backend");
  });
});

describe("Monorepo attribution", () => {
  it("attributes screens to their subproject so the user can pick a project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "repolens-mono-ui-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "apps", "web", "src"), { recursive: true });
    await mkdir(path.join(root, "apps", "docs"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "workspace", private: true, workspaces: ["apps/*"] }),
    );
    await writeFile(
      path.join(root, "apps", "web", "package.json"),
      JSON.stringify({ name: "web", scripts: { dev: "vite" }, dependencies: { react: "1", vite: "1" } }),
    );
    await writeFile(
      path.join(root, "apps", "web", "index.html"),
      "<html><head><title>Web app</title></head><body><div id=root></div></body></html>",
    );
    await writeFile(
      path.join(root, "apps", "docs", "package.json"),
      JSON.stringify({ name: "docs", scripts: { dev: "next dev" }, dependencies: { next: "1", react: "1" } }),
    );
    await writeFile(
      path.join(root, "apps", "docs", "index.html"),
      "<html><head><title>Docs</title></head><body></body></html>",
    );

    const analysis = await analyzeFixtureDirectory(root, "https://github.com/example/mono");
    expect(analysis.project.projectType).toBe("monorepo");
    const webScreen = analysis.interface.screens.find((screen) => screen.file === "apps/web/index.html");
    const docsScreen = analysis.interface.screens.find((screen) => screen.file === "apps/docs/index.html");
    expect(webScreen?.subprojectRoot).toBe("apps/web");
    expect(docsScreen?.subprojectRoot).toBe("apps/docs");
  });
});

describe("interface heuristics", () => {
  it("infers visual roles from component names", () => {
    expect(inferInterfaceRole("NavBar")).toBe("navigation");
    expect(inferInterfaceRole("SettingsModal")).toBe("modal");
    expect(inferInterfaceRole("LoginForm")).toBe("form");
    expect(inferInterfaceRole("MetricCard")).toBe("card");
    expect(inferInterfaceRole("UserTable")).toBe("table");
    expect(inferInterfaceRole("DarkModeToggle")).toBe("control");
    expect(inferInterfaceRole("HomePage")).toBe("page");
  });

  it("extracts readable control labels from sanitized HTML", () => {
    const controls = extractControls(
      '<button>Save</button><input type="email" placeholder="Work email"><select name="plan"></select>',
    );
    expect(controls).toEqual([
      "Button: Save",
      "Input (email): Work email",
      "Select: plan",
    ]);
  });

  it("summarizes languages and folders from the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "repolens-inventory-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "src", "b.css"), "body {}\n");
    const inventory = await inventoryWorkspace(root);
    expect(inventory.languages.map((language) => language.name).sort()).toEqual(["CSS", "TypeScript"]);
    expect(inventory.folders[0]).toContain("src/");
  });
});
