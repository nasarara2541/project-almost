import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DetectedFramework,
  DetectedSubproject,
  PackageManager,
  PreviewCandidate,
  RepositoryProjectInfo,
} from "../../types/api";
import type { AnalysisRepository } from "./repository-analyzer";

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);
const MAX_PACKAGE_FILES = 100;

type PackageJson = {
  name?: unknown;
  packageManager?: unknown;
  bin?: unknown;
  main?: unknown;
  module?: unknown;
  exports?: unknown;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  workspaces?: unknown;
};

const PYTHON_MANIFESTS = ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile"];
const BACKEND_MANIFESTS = ["go.mod", "Cargo.toml", "Gemfile", "composer.json", "pom.xml", "build.gradle"];

/** True when a manifest.json at this path declares a Chrome/WebExtension. */
async function isChromeExtensionManifest(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, "utf8");
    const manifest = JSON.parse(raw) as { manifest_version?: unknown };
    return typeof manifest.manifest_version === "number";
  } catch {
    return false;
  }
}

async function detectChromeExtension(root: string): Promise<boolean> {
  for (const candidate of ["manifest.json", "public/manifest.json", "src/manifest.json", "extension/manifest.json"]) {
    if (await isChromeExtensionManifest(path.join(root, candidate))) return true;
  }
  return false;
}

async function detectPythonProject(root: string): Promise<boolean> {
  for (const manifest of PYTHON_MANIFESTS) {
    if (await fileExists(path.join(root, manifest))) return true;
  }
  return false;
}

async function detectBackendProject(root: string): Promise<boolean> {
  for (const manifest of BACKEND_MANIFESTS) {
    if (await fileExists(path.join(root, manifest))) return true;
  }
  return false;
}

/** A package with a bin entry and no web framework is a Node CLI tool. */
function isNodeCli(manifest: PackageJson, frameworks: DetectedFramework[]): boolean {
  const hasBin =
    typeof manifest.bin === "string" ||
    (typeof manifest.bin === "object" && manifest.bin !== null && Object.keys(manifest.bin).length > 0);
  return hasBin && frameworks.length === 0;
}

/** A non-runnable package that publishes an entry point is a library. */
function isLibrary(manifest: PackageJson, frameworks: DetectedFramework[], scripts: string[]): boolean {
  const publishesEntry =
    typeof manifest.main === "string" ||
    typeof manifest.module === "string" ||
    manifest.exports !== undefined;
  const runsAsApp = scripts.some((script) => ["dev", "start", "serve", "preview"].includes(script));
  return publishesEntry && frameworks.length === 0 && !runsAsApp;
}

function normalize(relativePath: string): string {
  return relativePath.split(path.sep).join("/") || ".";
}

async function findPackageFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile() && entry.name === "package.json") {
        files.push(absolutePath);
        if (files.length > MAX_PACKAGE_FILES) {
          throw new Error("Repository contains more than 100 JavaScript package roots.");
        }
      }
    }
  }
  await visit(root);
  return files.sort();
}

function dependencyNames(manifest: PackageJson): Set<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

function detectFrameworks(manifest: PackageJson): DetectedFramework[] {
  const names = dependencyNames(manifest);
  const frameworks: DetectedFramework[] = [];
  if (names.has("next")) frameworks.push("next");
  if (names.has("nuxt")) frameworks.push("nuxt");
  if (names.has("@angular/core")) frameworks.push("angular");
  if (names.has("@sveltejs/kit") || names.has("svelte")) frameworks.push("svelte");
  if (names.has("astro")) frameworks.push("astro");
  if (names.has("vite")) frameworks.push("vite");
  if (names.has("vue")) frameworks.push("vue");
  if (names.has("react") || names.has("react-dom")) frameworks.push("react");
  return [...new Set(frameworks)];
}

function primaryFramework(frameworks: DetectedFramework[]): DetectedFramework {
  const priority: DetectedFramework[] = [
    "next",
    "nuxt",
    "angular",
    "svelte",
    "astro",
    "vite",
    "vue",
    "react",
  ];
  return priority.find((framework) => frameworks.includes(framework)) ?? "unknown";
}

async function fileExists(filePath: string): Promise<boolean> {
  return Boolean((await stat(filePath).catch(() => null))?.isFile());
}

async function detectPackageManager(
  repositoryRoot: string,
  packageRoot: string,
  manifest: PackageJson,
): Promise<PackageManager> {
  if (typeof manifest.packageManager === "string") {
    const name = manifest.packageManager.split("@")[0];
    if (["npm", "yarn", "pnpm", "bun"].includes(name)) return name as PackageManager;
  }
  for (const root of [...new Set([packageRoot, repositoryRoot])]) {
    if (
      (await fileExists(path.join(root, "pnpm-lock.yaml"))) ||
      (await fileExists(path.join(root, "pnpm-workspace.yaml")))
    ) return "pnpm";
    if (await fileExists(path.join(root, "yarn.lock"))) return "yarn";
    if (
      (await fileExists(path.join(root, "bun.lockb"))) ||
      (await fileExists(path.join(root, "bun.lock")))
    ) return "bun";
    if (await fileExists(path.join(root, "package-lock.json"))) return "npm";
  }
  return "unknown";
}

function isRunnable(scripts: string[], framework: DetectedFramework): boolean {
  return (
    framework !== "unknown" &&
    scripts.some((script) => ["dev", "start", "preview", "serve"].includes(script))
  );
}

export async function detectRepositoryProject(
  repository: AnalysisRepository,
  options: {
    verifiedLocal?: boolean;
    defaultBranch?: string;
    description?: string;
  } = {},
): Promise<RepositoryProjectInfo> {
  const packageFiles = await findPackageFiles(repository.sourcePath);
  const subprojects: DetectedSubproject[] = [];
  const allFrameworks = new Set<DetectedFramework>();
  const allPackageManagers = new Set<PackageManager>();
  let workspaceConfigured = false;

  for (const packageFile of packageFiles) {
    const manifest = JSON.parse(await readFile(packageFile, "utf8")) as PackageJson;
    const root = path.dirname(packageFile);
    const relativeRoot = normalize(path.relative(repository.sourcePath, root));
    const frameworks = detectFrameworks(manifest);
    let framework = primaryFramework(frameworks);
    if (await detectChromeExtension(root)) framework = "chrome-extension";
    else if (framework === "unknown" && isNodeCli(manifest, frameworks)) framework = "node-cli";
    else if (framework === "unknown" && isLibrary(manifest, frameworks, Object.keys(manifest.scripts ?? {})))
      framework = "library";
    const packageManager = await detectPackageManager(repository.sourcePath, root, manifest);
    const scripts = Object.entries(manifest.scripts ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([name]) => name)
      .sort();
    for (const item of frameworks) allFrameworks.add(item);
    if (packageManager !== "unknown") allPackageManagers.add(packageManager);
    if (manifest.workspaces) workspaceConfigured = true;
    subprojects.push({
      root: relativeRoot,
      name:
        typeof manifest.name === "string" && manifest.name.trim()
          ? manifest.name
          : relativeRoot === "."
            ? path.basename(repository.sourcePath)
            : path.basename(root),
      framework,
      packageManager,
      scripts,
      runnable: isRunnable(scripts, framework),
    });
  }

  // Non-JavaScript projects: a Python repository has no package.json roots
  // but still deserves classification and static context.
  if (await detectPythonProject(repository.sourcePath)) {
    allFrameworks.add("python");
    if (!subprojects.some((subproject) => subproject.root === ".")) {
      subprojects.push({
        root: ".",
        name: path.basename(repository.sourcePath),
        framework: "python",
        packageManager: "pip",
        scripts: [],
        runnable: false,
      });
    }
    allPackageManagers.add("pip");
  }

  // A Chrome extension without any package.json (plain manifest + scripts).
  if (subprojects.length === 0 && (await detectChromeExtension(repository.sourcePath))) {
    allFrameworks.add("chrome-extension");
    subprojects.push({
      root: ".",
      name: path.basename(repository.sourcePath),
      framework: "chrome-extension",
      packageManager: "unknown",
      scripts: [],
      runnable: false,
    });
  }

  const hasWorkspaceFile =
    (await fileExists(path.join(repository.sourcePath, "pnpm-workspace.yaml"))) ||
    (await fileExists(path.join(repository.sourcePath, "turbo.json"))) ||
    (await fileExists(path.join(repository.sourcePath, "nx.json")));
  const monorepo = packageFiles.length > 1 || workspaceConfigured || hasWorkspaceFile;
  const runnable = subprojects.filter((subproject) => subproject.runnable);
  // Previews now run entirely inside the visitor's browser (WebContainers),
  // so any runnable React, Next.js, or Vite project is eligible; the code
  // never executes on shared server infrastructure.
  const supportedRunnerFrameworks = new Set<DetectedFramework>(["vite", "next", "react"]);
  const unsupportedReasons: Partial<Record<DetectedFramework, string>> = {
    "chrome-extension":
      "Live preview unsupported: Chrome extensions must be loaded into a browser's extension system and cannot run as a web page.",
    "node-cli":
      "Live preview unsupported: CLI tools have no web interface to preview. The architecture map and tracing still work.",
    python:
      "Live preview unsupported: the in-browser sandbox runs Node.js, not Python. Analysis remains available.",
    library:
      "Live preview unsupported: libraries export code for other projects and have nothing to serve.",
  };
  const previewCandidates: PreviewCandidate[] = runnable.map((subproject) => {
    const available = supportedRunnerFrameworks.has(subproject.framework);
    const reason = available
      ? "This project can run as a sandboxed in-browser preview."
      : unsupportedReasons[subproject.framework] ??
        `Analysis available; live preview unavailable because ${subproject.framework} is not supported by the in-browser runtime yet.`;
    return { ...subproject, available, reason };
  });
  const availableCandidate = previewCandidates.find((candidate) => candidate.available);
  const frameworkSet = allFrameworks;
  const single = subprojects.length === 1 ? subprojects[0] : null;
  const backendManifest = await detectBackendProject(repository.sourcePath);
  const projectType: RepositoryProjectInfo["projectType"] = monorepo
    ? "monorepo"
    : single?.framework === "chrome-extension" || (frameworkSet.has("chrome-extension") && subprojects.length <= 1)
      ? "chrome-extension"
      : single?.framework === "python"
        ? "python"
        : single?.framework === "node-cli"
          ? "cli"
          : single?.framework === "library"
            ? "library"
            : [...frameworkSet].some(
                  (framework) => !["python", "chrome-extension", "node-cli", "library", "unknown"].includes(framework),
                )
              ? "frontend"
            : frameworkSet.has("python")
              ? "python"
              : backendManifest
                ? "backend"
                : packageFiles.length > 0
                  ? "library"
                  : "unknown";

  return {
    projectType,
    frameworks: [...allFrameworks],
    packageManagers: [...allPackageManagers],
    monorepo,
    subprojects,
    previewCandidates,
    previewAvailable: Boolean(availableCandidate),
    previewReason:
      availableCandidate?.reason ??
      previewCandidates[0]?.reason ??
      (subprojects.some((subproject) => subproject.framework === "python")
        ? "Live preview unsupported: the in-browser sandbox runs Node.js, not Python. Analysis remains available."
        : subprojects.some((subproject) => subproject.framework === "chrome-extension")
          ? "Live preview unsupported: Chrome extensions must be loaded into a browser's extension system and cannot run as a web page."
          : subprojects.some((subproject) => subproject.framework === "node-cli")
            ? "Live preview unsupported: CLI tools have no web interface to preview. The architecture map and tracing still work."
            : "Analysis available; live preview unavailable because no runnable frontend subproject was detected."),
    defaultBranch: options.defaultBranch,
    description: options.description,
    source: options.verifiedLocal ? "verified-local" : "github-readonly",
  };
}
