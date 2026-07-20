import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AnalysisCoverage,
  AnalyzedSourceFile,
  ArchitectureGraph,
  AuditCategory,
  AuditConfidence,
  AuditEvidence,
  AuditFinding,
  AuditSeverity,
  AuditStrength,
  ContributionDifficulty,
  ContributionOpportunity,
  InterfaceReport,
  RepositoryAudit,
  RepositoryProjectInfo,
} from "../../types/api";
import type { WorkspaceInventory } from "./interface-detector";
import type { AnalysisRepository } from "./repository-analyzer";

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro",
  ".py", ".rb", ".go", ".rs", ".php", ".java", ".kt", ".swift", ".c", ".h",
  ".cpp", ".cc", ".cs", ".sh",
]);
const SCANNABLE_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, ".html", ".htm"]);
const MAX_SCANNED_FILES = 750;
const MAX_SCANNED_FILE_BYTES = 512 * 1024;
const LARGE_SOURCE_BYTES = 200 * 1024;
const AMBIENT_ENVIRONMENT_VARIABLES = new Set([
  "CI",
  "GITHUB_ACTIONS",
  "JEST_WORKER_ID",
  "NETLIFY",
  "NODE_DEBUG",
  "NODE_ENV",
  "TZ",
  "VERCEL",
]);

type PackageManifest = {
  path: string;
  scripts: Record<string, string>;
  engines?: Record<string, unknown>;
};

type SourceSignals = {
  todos: { file: string; line: number; marker: string }[];
  environmentVariables: { file: string; line: number; name: string }[];
  imagesWithoutAlt: { file: string; line: number }[];
};

type AuditInput = {
  repository: AnalysisRepository;
  inventory: WorkspaceInventory;
  files: AnalyzedSourceFile[];
  graph: ArchitectureGraph;
  project: RepositoryProjectInfo;
  interfaceReport: InterfaceReport;
};

const categoryLabels: Record<AuditCategory, string> = {
  community: "Community readiness",
  "developer-experience": "Developer experience",
  testing: "Testing & automation",
  maintainability: "Maintainability",
  "frontend-quality": "Frontend quality",
};

const severityWeight: Record<AuditSeverity, number> = {
  high: 16,
  medium: 9,
  low: 4,
  info: 0,
};

const severityOrder: Record<AuditSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
};

function lineForOffset(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

async function readWorkspaceText(
  repository: AnalysisRepository,
  relativePath: string,
): Promise<string | null> {
  const root = path.resolve(/* turbopackIgnore: true */ repository.sourcePath);
  const absolute = path.resolve(/* turbopackIgnore: true */ root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return null;
  return readFile(/* turbopackIgnore: true */ absolute, "utf8").catch(() => null);
}

function basenameMatches(filePath: string, pattern: RegExp): boolean {
  return pattern.test(path.posix.basename(filePath));
}

function findFirst(files: string[], predicate: (file: string) => boolean): string | undefined {
  return files.find(predicate);
}

async function loadPackageManifests(
  repository: AnalysisRepository,
  inventory: WorkspaceInventory,
): Promise<{ manifests: PackageManifest[]; invalid: string[] }> {
  const manifests: PackageManifest[] = [];
  const invalid: string[] = [];
  for (const file of inventory.files.filter((item) => path.posix.basename(item.path) === "package.json")) {
    const source = await readWorkspaceText(repository, file.path);
    if (!source) continue;
    try {
      const parsed = JSON.parse(source) as {
        scripts?: Record<string, unknown>;
        engines?: Record<string, unknown>;
      };
      manifests.push({
        path: file.path,
        scripts: Object.fromEntries(
          Object.entries(parsed.scripts ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
        engines: parsed.engines,
      });
    } catch {
      invalid.push(file.path);
    }
  }
  return { manifests, invalid };
}

async function scanSourceSignals(
  repository: AnalysisRepository,
  inventory: WorkspaceInventory,
): Promise<SourceSignals> {
  const signals: SourceSignals = { todos: [], environmentVariables: [], imagesWithoutAlt: [] };
  const candidates = inventory.files.filter((file) =>
    SCANNABLE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()) &&
    file.size <= MAX_SCANNED_FILE_BYTES,
  ).slice(0, MAX_SCANNED_FILES);

  for (const file of candidates) {
    const source = await readWorkspaceText(repository, file.path);
    if (source === null) continue;

    const todoPattern = /\b(TODO|FIXME|HACK)\b/gi;
    for (const match of source.matchAll(todoPattern)) {
      if (signals.todos.length >= 100) break;
      signals.todos.push({
        file: file.path,
        line: lineForOffset(source, match.index ?? 0),
        marker: match[1].toUpperCase(),
      });
    }

    const environmentPattern = /(?:process\.env\.|import\.meta\.env\.)([A-Z][A-Z0-9_]*)/g;
    for (const match of source.matchAll(environmentPattern)) {
      if (AMBIENT_ENVIRONMENT_VARIABLES.has(match[1])) continue;
      if (signals.environmentVariables.some((item) => item.name === match[1])) continue;
      signals.environmentVariables.push({
        file: file.path,
        line: lineForOffset(source, match.index ?? 0),
        name: match[1],
      });
    }

    if ([".jsx", ".tsx", ".html", ".htm", ".vue", ".svelte", ".astro"].includes(
      path.posix.extname(file.path).toLowerCase(),
    )) {
      const imagePattern = /<img\b(?![^>]*\balt\s*=)[^>]*>/gi;
      for (const match of source.matchAll(imagePattern)) {
        if (signals.imagesWithoutAlt.length >= 50) break;
        signals.imagesWithoutAlt.push({
          file: file.path,
          line: lineForOffset(source, match.index ?? 0),
        });
      }
    }
  }
  return signals;
}

function makeFinding(input: AuditFinding): AuditFinding {
  return input;
}

function missingEvidence(label: string, searched: string): AuditEvidence {
  return { label, value: `Not found. Checked ${searched}.`, status: "missing" };
}

function sourceEvidence(
  label: string,
  value: string,
  file: string,
  lineStart = 1,
): AuditEvidence {
  return {
    label,
    value,
    status: "signal",
    location: { file, lineStart },
  };
}

function isLikelyConventionLoaded(
  file: AnalyzedSourceFile,
  routeFiles: Set<string>,
  project: RepositoryProjectInfo,
): boolean {
  const normalized = file.path.toLowerCase();
  const basename = path.posix.basename(normalized);
  if (file.entryPoint || routeFiles.has(file.path)) return true;
  if (/\.d\.[cm]?ts$/.test(normalized)) return true;
  if (/(^|\/)(__mocks__|mocks?|__tests__|tests?|spec|stories|storybook|scripts?|migrations?|fixtures?|\.config)\//.test(normalized)) return true;
  if (/\.(?:test|spec|stories?)\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/(^|\/)pages\/api\//.test(normalized)) return true;
  if (/^(?:index|main|module|setup|register|instrumentation|middleware|service-worker|worker|polyfills?)\.[cm]?[jt]sx?$/.test(basename)) return true;
  if (/^(?:jest[-.]setup|setup[-.][^.]+)\.[cm]?[jt]sx?$/.test(basename)) return true;
  if (/^\.[a-z0-9_-]+rc(?:\.[cm]?[jt]s)?$/.test(basename)) return true;
  if (/(?:^|\.)(?:config|setup)\.[cm]?[jt]s$/.test(basename)) return true;
  if (/^(?:vite-env|next-env)\.d\.ts$/.test(basename)) return true;
  if (project.frameworks.includes("next") && /(^|\/)app\/(?:.*\/)?(?:page|layout|loading|error|not-found|template|route)\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (project.frameworks.includes("next") && /(^|\/)pages\/.*\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (project.frameworks.includes("chrome-extension") && /(?:background|content|popup|options|devtools|service-worker)\.[cm]?[jt]s$/.test(basename)) return true;
  return false;
}

function buildCoverage(input: AuditInput): AnalysisCoverage {
  const acquisition = input.repository.acquisition;
  const repositoryFiles = acquisition?.repositoryFiles ?? input.inventory.files.length;
  const supportedFiles = acquisition?.supportedFiles ?? input.inventory.files.length;
  const fetchedFiles = acquisition?.fetchedFiles ?? input.inventory.files.length;
  const skippedFiles = acquisition?.skippedFiles ?? [];
  const coveragePercent = supportedFiles > 0
    ? Math.round((Math.min(fetchedFiles, supportedFiles) / supportedFiles) * 1000) / 10
    : 100;
  const limitations = [
    "Results come from static source inspection; runtime-only behavior and dynamically constructed imports may not be visible.",
  ];
  if (skippedFiles.length > 0) {
    limitations.push(`${skippedFiles.length} supported file${skippedFiles.length === 1 ? " was" : "s were"} skipped; findings do not cover their contents.`);
  }
  const unsupported = Math.max(0, repositoryFiles - supportedFiles);
  if (unsupported > 0) {
    limitations.push(`${unsupported} repository file${unsupported === 1 ? " was" : "s were"} outside the supported analysis types.`);
  }
  const scannableFiles = input.inventory.files.filter((file) =>
    SCANNABLE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()) &&
    file.size <= MAX_SCANNED_FILE_BYTES,
  ).length;
  if (scannableFiles > MAX_SCANNED_FILES) {
    limitations.push(`Content-level signals such as TODOs, environment variables, and image alt attributes were scanned in the first ${MAX_SCANNED_FILES} eligible files out of ${scannableFiles}.`);
  }
  return {
    repositoryFiles,
    supportedFiles,
    fetchedFiles,
    analyzedSourceFiles: input.files.length,
    skippedFiles,
    coveragePercent,
    complete: skippedFiles.length === 0,
    limitations,
  };
}

function buildOpportunities(findings: AuditFinding[]): ContributionOpportunity[] {
  return findings
    .filter((finding) =>
      finding.confidence !== "low" &&
      (["high", "medium"].includes(finding.severity) || finding.id === "maintainability:possibly-unreferenced"),
    )
    .slice(0, 6)
    .map((finding) => ({
      id: `opportunity:${finding.id}`,
      findingId: finding.id,
      title: finding.title,
      impact: finding.severity,
      difficulty: finding.difficulty,
      summary: finding.recommendation,
      task: finding.contributionTask,
      files: finding.files,
    }));
}

function statusForScore(score: number): RepositoryAudit["status"] {
  if (score >= 85) return "strong";
  if (score >= 70) return "solid";
  if (score >= 50) return "needs-attention";
  return "significant-gaps";
}

/**
 * Produces a deterministic repository audit. Findings are limited to facts
 * supported by fetched files plus clearly labelled static-analysis signals.
 */
export async function auditRepository(input: AuditInput): Promise<RepositoryAudit> {
  const findings: AuditFinding[] = [];
  const strengths: AuditStrength[] = [];
  const paths = input.inventory.files.map((file) => file.path);
  const lowerPaths = paths.map((file) => file.toLowerCase());
  const packageLoad = await loadPackageManifests(input.repository, input.inventory);
  const packages = packageLoad.manifests;
  const signals = await scanSourceSignals(input.repository, input.inventory);
  const allScripts = new Set(packages.flatMap((manifest) => Object.keys(manifest.scripts)));
  const coverage = buildCoverage(input);
  const sourceFileCount = input.inventory.files.filter((file) =>
    SOURCE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()),
  ).length;

  if (packageLoad.invalid.length > 0) {
    findings.push(makeFinding({
      id: "devex:invalid-package-manifest",
      category: "developer-experience",
      severity: "high",
      confidence: "high",
      title: `${packageLoad.invalid.length} package manifest${packageLoad.invalid.length === 1 ? " is" : "s are"} not valid JSON`,
      summary: "RepoLens could not parse the named package.json files.",
      whyItMatters: "Package managers and development tools cannot reliably install or run a project with an invalid manifest.",
      recommendation: "Correct the JSON syntax and verify the manifest with the project’s package manager.",
      evidence: packageLoad.invalid.map((file) => sourceEvidence("Invalid JSON", "package.json could not be parsed", file)),
      files: packageLoad.invalid,
      difficulty: "quick-win",
      contributionTask: `Fix the JSON syntax in ${packageLoad.invalid.join(", ")} and verify dependency installation plus the documented project commands.`,
    }));
  }

  const readme = findFirst(paths, (file) => basenameMatches(file, /^readme(?:\.|$)/i));
  const license = findFirst(paths, (file) => basenameMatches(file, /^(?:licen[cs]e|copying)(?:\.|$)/i));
  const contributing = findFirst(paths, (file) => basenameMatches(file, /^contributing(?:\.|$)/i));
  const codeOfConduct = findFirst(paths, (file) => basenameMatches(file, /^code[_-]of[_-]conduct(?:\.|$)/i));
  const security = findFirst(paths, (file) => basenameMatches(file, /^security(?:\.|$)/i));
  const issueTemplate = findFirst(lowerPaths, (file) => file.startsWith(".github/issue_template/"));
  const pullRequestTemplate = findFirst(lowerPaths, (file) =>
    /(^|\/)pull_request_template(?:\/|\.)/.test(file),
  );

  if (readme) {
    strengths.push({ id: "community:readme", category: "community", title: "README is present", evidence: readme });
  } else {
    findings.push(makeFinding({
      id: "community:missing-readme",
      category: "community",
      severity: "high",
      confidence: "high",
      title: "The repository has no README",
      summary: "No README file was found in the analyzed repository.",
      whyItMatters: "Contributors need a clear explanation of the project, setup steps, and expected workflow before they can help safely.",
      recommendation: "Add a README covering purpose, prerequisites, installation, development, testing, and contribution links.",
      evidence: [missingEvidence("README", "README, README.md, README.txt, and case variants")],
      files: [],
      difficulty: "moderate",
      contributionTask: "Create a root README that explains the project, prerequisites, installation, development commands, tests, and how to contribute.",
    }));
  }

  if (license) {
    strengths.push({ id: "community:license", category: "community", title: "License is declared", evidence: license });
  } else {
    findings.push(makeFinding({
      id: "community:missing-license",
      category: "community",
      severity: "high",
      confidence: "high",
      title: "No license file was found",
      summary: "The fetched repository does not contain a conventional license file.",
      whyItMatters: "Without an explicit license, other people may not have legal permission to use, modify, or redistribute the project.",
      recommendation: "Choose an appropriate license with the project owner and add it at the repository root.",
      evidence: [missingEvidence("License", "LICENSE*, LICENCE*, and COPYING*")],
      files: [],
      difficulty: "quick-win",
      contributionTask: "Confirm the intended open-source license with the maintainer and add the corresponding license file at the repository root.",
      limitation: "RepoLens can confirm that a conventional license file is missing, but it cannot choose the correct legal license for the project.",
    }));
  }

  const missingCommunity = [
    !contributing ? "contribution guide" : null,
    !codeOfConduct ? "code of conduct" : null,
    !security ? "security policy" : null,
    !issueTemplate ? "issue template" : null,
    !pullRequestTemplate ? "pull-request template" : null,
  ].filter((item): item is string => Boolean(item));
  if (missingCommunity.length > 0) {
    findings.push(makeFinding({
      id: "community:missing-contributor-files",
      category: "community",
      severity: "medium",
      confidence: "high",
      title: `${missingCommunity.length} contributor-support file${missingCommunity.length === 1 ? " is" : "s are"} missing`,
      summary: `Missing: ${missingCommunity.join(", ")}.`,
      whyItMatters: "Consistent contribution and reporting guidance reduces maintainer effort and makes first contributions safer.",
      recommendation: "Add the missing community health files, starting with CONTRIBUTING.md and repository templates.",
      evidence: missingCommunity.map((item) => missingEvidence(item, "the repository root and .github directory")),
      files: [],
      difficulty: "quick-win",
      contributionTask: `Add the missing repository community files: ${missingCommunity.join(", ")}. Keep each document specific to this project rather than using unexplained boilerplate.`,
    }));
  } else {
    strengths.push({
      id: "community:contributor-support",
      category: "community",
      title: "Contributor support files are complete",
      evidence: "Contribution guide, conduct and security policies, and issue/PR templates were found.",
    });
  }

  const readmeSource = readme ? await readWorkspaceText(input.repository, readme) : null;
  const hasSetupGuidance = Boolean(readmeSource && /(?:getting started|installation|npm\s+(?:install|ci)|pnpm\s+install|yarn\s+install|bun\s+install|pip\s+install|go\s+(?:build|run)|cargo\s+(?:build|run))/i.test(readmeSource));
  if (packages.length > 0 && readme && !hasSetupGuidance) {
    findings.push(makeFinding({
      id: "devex:missing-setup-guidance",
      category: "developer-experience",
      severity: "medium",
      confidence: "medium",
      title: "README setup instructions are not clearly detectable",
      summary: "A README exists, but RepoLens could not find conventional installation or getting-started commands in it.",
      whyItMatters: "A contributor should be able to get from clone to a working development environment without reverse-engineering package scripts.",
      recommendation: "Add a concise prerequisites, installation, development, and verification section to the README.",
      evidence: [sourceEvidence("README checked", "No conventional setup command was detected", readme)],
      files: [readme],
      difficulty: "quick-win",
      contributionTask: `Improve ${readme} with prerequisites, dependency installation, local development, test, and build commands that match package.json.`,
      limitation: "Unusually worded or externally hosted setup instructions may not be recognized.",
    }));
  } else if (hasSetupGuidance && readme) {
    strengths.push({ id: "devex:setup", category: "developer-experience", title: "Setup guidance is documented", evidence: readme });
  }

  if (packages.length > 0) {
    const missingScripts = [
      ![...allScripts].some((script) => ["dev", "start", "serve"].includes(script)) ? "development/start" : null,
      !allScripts.has("build") && input.project.projectType === "frontend" ? "build" : null,
      ![...allScripts].some((script) => /^(?:lint|format|typecheck|type-check)$/.test(script)) ? "code-quality" : null,
    ].filter((item): item is string => Boolean(item));
    if (missingScripts.length > 0) {
      findings.push(makeFinding({
        id: "devex:missing-scripts",
        category: "developer-experience",
        severity: missingScripts.includes("development/start") ? "medium" : "low",
        confidence: "high",
        title: `Package scripts do not expose ${missingScripts.join(" or ")}`,
        summary: `No conventional ${missingScripts.join(", ")} script was found across ${packages.length} package manifest${packages.length === 1 ? "" : "s"}.`,
        whyItMatters: "Predictable scripts give contributors one documented way to run and verify changes.",
        recommendation: "Add or document conventional package scripts that wrap the project’s existing tooling.",
        evidence: packages.map((manifest) => sourceEvidence("Package scripts", Object.keys(manifest.scripts).join(", ") || "No scripts", manifest.path)),
        files: packages.map((manifest) => manifest.path),
        difficulty: "quick-win",
        contributionTask: `Add or document the missing ${missingScripts.join(", ")} package scripts and verify they work from a clean checkout.`,
      }));
    } else {
      strengths.push({ id: "devex:scripts", category: "developer-experience", title: "Core development scripts are available", evidence: [...allScripts].sort().join(", ") });
    }
  }

  const hasEnvironmentExample = lowerPaths.some((file) => /(^|\/)\.env\.example$/.test(file));
  if (signals.environmentVariables.length > 0 && !hasEnvironmentExample) {
    const names = signals.environmentVariables.map((item) => item.name).sort();
    findings.push(makeFinding({
      id: "devex:missing-env-example",
      category: "developer-experience",
      severity: "medium",
      confidence: "medium",
      title: `${names.length} environment variable${names.length === 1 ? " is" : "s are"} referenced without an .env.example`,
      summary: `Detected environment references: ${names.join(", ")}.`,
      whyItMatters: "Contributors cannot reliably configure the project if required variable names and safe example values are undocumented.",
      recommendation: "Add a committed .env.example containing variable names and non-secret placeholders, then document which values are optional.",
      evidence: signals.environmentVariables.slice(0, 20).map((item) => sourceEvidence("Environment reference", item.name, item.file, item.line)),
      files: [...new Set(signals.environmentVariables.map((item) => item.file))],
      difficulty: "quick-win",
      contributionTask: `Create .env.example for ${names.join(", ")} using safe placeholders only, and document required versus optional variables.`,
      limitation: "A static reference does not prove that a variable is required; it may be optional or injected by a deployment platform. Confirm usage before documenting it.",
    }));
  } else if (signals.environmentVariables.length > 0) {
    strengths.push({ id: "devex:env-example", category: "developer-experience", title: "Environment variables have an example file", evidence: ".env.example" });
  }

  const hasRuntimeVersion = lowerPaths.some((file) => /(^|\/)(?:\.nvmrc|\.node-version)$/.test(file)) ||
    packages.some((manifest) => typeof manifest.engines?.node === "string");
  if (packages.length > 0 && !hasRuntimeVersion) {
    findings.push(makeFinding({
      id: "devex:runtime-version",
      category: "developer-experience",
      severity: "low",
      confidence: "high",
      title: "Node.js version requirements are not declared",
      summary: "No engines.node, .nvmrc, or .node-version declaration was found.",
      whyItMatters: "Different Node.js versions can produce installation, build, and runtime differences for contributors.",
      recommendation: "Declare the supported Node.js range in package.json and optionally add a version-manager file.",
      evidence: [missingEvidence("Node.js version", "package.json engines.node, .nvmrc, and .node-version")],
      files: packages.map((manifest) => manifest.path),
      difficulty: "quick-win",
      contributionTask: "Confirm the supported Node.js versions, add engines.node to package.json, and document the requirement in the README.",
    }));
  }

  const testFiles = paths.filter((file) =>
    /(^|\/)(?:__tests__|tests?|spec)(?:\/|$)|\.(?:test|spec)\.[^.\/]+$|(^|\/)test_[^/]+\.py$|_test\.go$/i.test(file),
  );
  const hasTestScript = [...allScripts].some((script) => /^(?:test|test:|check$)/.test(script));
  if (sourceFileCount > 0 && testFiles.length === 0) {
    findings.push(makeFinding({
      id: "testing:no-tests",
      category: "testing",
      severity: "high",
      confidence: coverage.complete ? "high" : "medium",
      title: "No test files were detected",
      summary: `RepoLens found ${sourceFileCount} source files but no conventional test files.`,
      whyItMatters: "Without automated tests, contributors have less protection against regressions and maintainers must review behavior manually.",
      recommendation: "Add a small test foundation around the project’s most important behavior before targeting broad coverage.",
      evidence: [missingEvidence("Test files", "test/, tests/, __tests__/, *.test.*, and *.spec.*")],
      files: [],
      difficulty: "moderate",
      contributionTask: "Identify the highest-value behavior, add the project’s preferred test framework, and contribute an initial focused test suite with a documented test command.",
      limitation: coverage.complete ? undefined : "Some files were skipped, so tests could exist outside the analyzed coverage.",
    }));
  } else if (testFiles.length > 0) {
    strengths.push({ id: "testing:tests", category: "testing", title: `${testFiles.length} test file${testFiles.length === 1 ? " was" : "s were"} detected`, evidence: testFiles.slice(0, 5).join(", ") });
  }

  if (packages.length > 0 && testFiles.length > 0 && !hasTestScript) {
    findings.push(makeFinding({
      id: "testing:no-test-script",
      category: "testing",
      severity: "medium",
      confidence: "high",
      title: "Tests exist but no conventional test script was found",
      summary: `${testFiles.length} test files were found, but package manifests do not expose a test command.`,
      whyItMatters: "Contributors and CI need one predictable command to verify changes.",
      recommendation: "Add a package test script that runs the existing suite and document it.",
      evidence: [sourceEvidence("Example test", "Test file detected", testFiles[0])],
      files: [...packages.map((manifest) => manifest.path), ...testFiles.slice(0, 3)],
      difficulty: "quick-win",
      contributionTask: "Add a conventional test script to package.json that runs the existing tests, then document and verify it.",
    }));
  }

  const workflows = paths.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file));
  const workflowSources = await Promise.all(workflows.map(async (file) => ({
    file,
    source: await readWorkspaceText(input.repository, file),
  })));
  const workflowRunsTests = workflowSources.some(({ source }) => source && /(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:vitest|jest|pytest|go test|cargo test)\b/i.test(source));
  if (sourceFileCount > 0 && workflows.length === 0) {
    findings.push(makeFinding({
      id: "testing:no-ci",
      category: "testing",
      severity: testFiles.length > 0 ? "medium" : "low",
      confidence: "high",
      title: "No GitHub Actions workflow was found",
      summary: "The repository has source code but no workflow under .github/workflows.",
      whyItMatters: "Automated pull-request checks make contributions safer and reduce repetitive maintainer verification.",
      recommendation: "Add a minimal workflow that installs dependencies and runs the project’s existing verification commands.",
      evidence: [missingEvidence("GitHub Actions", ".github/workflows/*.yml and *.yaml")],
      files: [],
      difficulty: "quick-win",
      contributionTask: "Add a GitHub Actions pull-request workflow that installs dependencies with the lockfile and runs tests, type checking, linting, and the build where available.",
    }));
  } else if (workflows.length > 0 && testFiles.length > 0 && !workflowRunsTests) {
    findings.push(makeFinding({
      id: "testing:ci-does-not-run-tests",
      category: "testing",
      severity: "medium",
      confidence: "medium",
      title: "CI exists, but no test command was detected",
      summary: `${workflows.length} workflow file${workflows.length === 1 ? " was" : "s were"} found without a recognizable test invocation.`,
      whyItMatters: "A test suite only protects pull requests when it is run consistently.",
      recommendation: "Run the repository’s documented test command in the pull-request workflow.",
      evidence: workflows.map((file) => sourceEvidence("Workflow checked", "No recognizable test command", file)),
      files: workflows,
      difficulty: "quick-win",
      contributionTask: "Update the pull-request workflow to run the existing test command and fail when tests fail.",
      limitation: "Custom composite actions or unusually named commands may not be recognized.",
    }));
  } else if (workflows.length > 0 && (testFiles.length === 0 || workflowRunsTests)) {
    strengths.push({ id: "testing:ci", category: "testing", title: "Continuous integration is configured", evidence: workflows.join(", ") });
  }

  const largeSources = input.inventory.files.filter((file) =>
    SOURCE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()) && file.size >= LARGE_SOURCE_BYTES,
  );
  if (largeSources.length > 0) {
    findings.push(makeFinding({
      id: "maintainability:large-source-files",
      category: "maintainability",
      severity: "medium",
      confidence: "high",
      title: `${largeSources.length} unusually large source file${largeSources.length === 1 ? " was" : "s were"} found`,
      summary: "Large source files are harder to review, test, and change safely and may be generated bundles rather than maintainable source.",
      whyItMatters: "Concentrated logic increases review cost and can conceal generated or duplicated code.",
      recommendation: "Confirm whether each file is generated. Exclude generated output or split maintainable source along clear responsibilities.",
      evidence: largeSources.map((file) => sourceEvidence("Large source", `${Math.round(file.size / 1024)} KB`, file.path)),
      files: largeSources.map((file) => file.path),
      difficulty: "substantial",
      contributionTask: `Review these large source files and document whether they are generated; remove generated artifacts or propose a safe decomposition: ${largeSources.map((file) => file.path).join(", ")}.`,
    }));
  }

  const oversized = coverage.skippedFiles.filter((file) => file.reason === "oversized");
  if (oversized.length > 0) {
    findings.push(makeFinding({
      id: "maintainability:oversized-skipped-files",
      category: "maintainability",
      severity: "info",
      confidence: "high",
      title: `${oversized.length} oversized file${oversized.length === 1 ? " was" : "s were"} skipped`,
      summary: "The rest of the repository was analyzed, but these files exceeded the per-file safety limit.",
      whyItMatters: "Skipped files reduce audit coverage and are often generated bundles, exported data, or assets that should be identified explicitly.",
      recommendation: "Review whether these files are generated or essential source and keep generated output outside the maintainable source tree when practical.",
      evidence: oversized.map((file) => ({ label: "Skipped file", value: `${file.path} (${Math.round(file.size / 1024)} KB)`, status: "signal" as const })),
      files: oversized.map((file) => file.path),
      difficulty: "moderate",
      contributionTask: `Review the skipped oversized files and document or remove generated artifacts where appropriate: ${oversized.map((file) => file.path).join(", ")}.`,
      limitation: "RepoLens did not inspect the contents of these files.",
    }));
  }

  if (signals.todos.length > 0) {
    const byMarker = signals.todos.reduce<Record<string, number>>((counts, item) => {
      counts[item.marker] = (counts[item.marker] ?? 0) + 1;
      return counts;
    }, {});
    findings.push(makeFinding({
      id: "maintainability:todo-markers",
      category: "maintainability",
      severity: "low",
      confidence: "high",
      title: `${signals.todos.length} TODO/FIXME/HACK marker${signals.todos.length === 1 ? " was" : "s were"} found`,
      summary: Object.entries(byMarker).map(([marker, count]) => `${marker}: ${count}`).join(" · "),
      whyItMatters: "Untracked maintenance notes can represent forgotten defects or incomplete work with no owner or context.",
      recommendation: "Review each marker, remove stale notes, and convert valid work into documented issues with context.",
      evidence: signals.todos.slice(0, 30).map((item) => sourceEvidence(item.marker, "Maintenance marker", item.file, item.line)),
      files: [...new Set(signals.todos.map((item) => item.file))],
      difficulty: "quick-win",
      contributionTask: "Triage the detected TODO/FIXME/HACK markers: remove stale comments, resolve small items, and create linked issues for valid remaining work.",
    }));
  }

  const routeFiles = new Set(
    input.graph.nodes
      .filter((node) => node.type === "route")
      .flatMap((node) => node.locations.map((location) => location.file)),
  );
  const unreferenced = input.files.filter((file) =>
    file.dependents.length === 0 && !isLikelyConventionLoaded(file, routeFiles, input.project),
  );
  if (unreferenced.length > 0) {
    findings.push(makeFinding({
      id: "maintainability:possibly-unreferenced",
      category: "maintainability",
      severity: "medium",
      confidence: "medium",
      title: `${unreferenced.length} source file${unreferenced.length === 1 ? " appears" : "s appear"} to have zero static references`,
      summary: `Possibly unreferenced: ${unreferenced.map((file) => file.path).join(", ")}.`,
      whyItMatters: "Unused code adds uncertainty, maintenance cost, and review surface. Confirming it is unused can safely simplify the project.",
      recommendation: "Verify each named file against runtime registration and framework conventions, then remove it or document why it is loaded indirectly.",
      evidence: unreferenced.map((file) => sourceEvidence("Zero static inbound references", file.path, file.path)),
      files: unreferenced.map((file) => file.path),
      difficulty: "moderate",
      contributionTask: `Verify these possibly unreferenced files, add tests before risky removals, then remove or document each one: ${unreferenced.map((file) => file.path).join(", ")}.`,
      limitation: "Zero static fan-in is not proof of dead code. Dynamic imports, dependency injection, framework conventions, HTML script tags, and external consumers may load a file without a detectable import.",
    }));
  } else if (input.files.length > 0) {
    strengths.push({ id: "maintainability:references", category: "maintainability", title: "No ordinary source files with zero static references were found", evidence: `${input.files.length} parsed source files checked with convention-loaded files excluded.` });
  }

  const riskyFiles = input.graph.nodes.filter((node) => node.type === "file" && node.risky);
  if (riskyFiles.length > 0) {
    findings.push(makeFinding({
      id: "maintainability:central-files",
      category: "maintainability",
      severity: "low",
      confidence: "high",
      title: `${riskyFiles.length} highly connected file${riskyFiles.length === 1 ? " was" : "s were"} identified`,
      summary: "These files have unusually high static fan-in relative to the rest of the analyzed dependency graph.",
      whyItMatters: "Changes to central files can affect many consumers and deserve focused tests and careful review.",
      recommendation: "Confirm that central responsibilities are intentional and prioritize regression tests around these files.",
      evidence: riskyFiles.map((node) => sourceEvidence("High fan-in", `${node.fanIn} incoming relationships`, node.locations[0]?.file ?? node.label)),
      files: riskyFiles.map((node) => node.locations[0]?.file).filter((file): file is string => Boolean(file)),
      difficulty: "moderate",
      contributionTask: "Review the named high-fan-in files, document their responsibility, and add focused regression tests before attempting structural changes.",
    }));
  }

  if (input.interfaceReport.hasVisualInterface && signals.imagesWithoutAlt.length > 0) {
    findings.push(makeFinding({
      id: "frontend:images-without-alt",
      category: "frontend-quality",
      severity: "medium",
      confidence: "high",
      title: `${signals.imagesWithoutAlt.length} image element${signals.imagesWithoutAlt.length === 1 ? " is" : "s are"} missing an alt attribute`,
      summary: "Literal image elements without an alt attribute were found in interface source.",
      whyItMatters: "Images without alt attributes create accessibility barriers and can fail automated accessibility requirements.",
      recommendation: "Add meaningful alt text for informative images and alt=\"\" for decorative images.",
      evidence: signals.imagesWithoutAlt.map((item) => sourceEvidence("Missing alt", "<img> has no alt attribute", item.file, item.line)),
      files: [...new Set(signals.imagesWithoutAlt.map((item) => item.file))],
      difficulty: "quick-win",
      contributionTask: "Review each identified image and add meaningful alt text, or an empty alt attribute when the image is purely decorative.",
    }));
  } else if (input.interfaceReport.hasVisualInterface) {
    strengths.push({ id: "frontend:img-alt", category: "frontend-quality", title: "No literal image elements missing alt attributes were found", evidence: "Analyzed JSX and template image elements." });
  }

  const failedFetches = coverage.skippedFiles.filter((file) => file.reason === "fetch-failed");
  if (failedFetches.length > 0) {
    findings.push(makeFinding({
      id: "coverage:fetch-failures",
      category: "maintainability",
      severity: "info",
      confidence: "high",
      title: `${failedFetches.length} supported file${failedFetches.length === 1 ? " could" : "s could"} not be fetched`,
      summary: "The audit continued with partial results instead of failing the entire repository.",
      whyItMatters: "Findings may not cover code or documentation contained in missing files.",
      recommendation: "Retry the analysis and verify the named files directly on GitHub if decisions depend on them.",
      evidence: failedFetches.map((file) => ({ label: "Fetch failed", value: file.path, status: "signal" as const })),
      files: failedFetches.map((file) => file.path),
      difficulty: "quick-win",
      contributionTask: "Retry this audit before acting on coverage-sensitive findings.",
    }));
  }

  findings.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity] || a.title.localeCompare(b.title),
  );

  const applicableCategories: AuditCategory[] = [
    "community", "developer-experience", "testing", "maintainability",
    ...(input.interfaceReport.hasVisualInterface ? ["frontend-quality" as const] : []),
  ];
  const categoryScores = applicableCategories.map((category) => {
    const categoryFindings = findings.filter((finding) => finding.category === category);
    return {
      category,
      score: Math.max(0, 100 - categoryFindings.reduce((total, finding) => total + severityWeight[finding.severity], 0)),
      findingCount: categoryFindings.length,
    };
  });
  const rawScore = categoryScores.length
    ? Math.round(categoryScores.reduce((total, category) => total + category.score, 0) / categoryScores.length)
    : 100;
  const actionableCount = findings.filter((finding) => finding.severity !== "info").length;
  const highCount = findings.filter((finding) => finding.severity === "high").length;
  // A simple category average must not describe a repository as strong while
  // high-priority gaps are still open. The cap is visible through those exact
  // findings, so the score remains explainable rather than mysterious.
  const score = highCount >= 2 ? Math.min(rawScore, 69) : highCount === 1 ? Math.min(rawScore, 79) : rawScore;
  const status = statusForScore(score);
  const headline = highCount > 0
    ? `${highCount} high-priority gap${highCount === 1 ? " needs" : "s need"} attention`
    : actionableCount > 0
      ? `${actionableCount} actionable improvement${actionableCount === 1 ? " was" : "s were"} found`
      : "No actionable gaps were found by the current checks";
  const summary = `${coverage.coveragePercent}% of supported files were fetched. ${findings.length} finding${findings.length === 1 ? "" : "s"} and ${strengths.length} verified strength${strengths.length === 1 ? "" : "s"} were produced from repository evidence.`;

  return {
    score,
    status,
    headline,
    summary,
    categoryScores,
    findings,
    strengths,
    opportunities: buildOpportunities(findings),
    coverage,
    generatedAt: new Date().toISOString(),
  };
}

export function auditCategoryLabel(category: AuditCategory): string {
  return categoryLabels[category];
}
