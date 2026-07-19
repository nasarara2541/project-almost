export type PreviewSessionStatus =
  | "queued"
  | "analyzing"
  | "starting"
  | "ready"
  | "failed"
  | "expired";

export type SupportedFramework = "react" | "next" | "vite";

export type PreviewSession = {
  id: string;
  repoUrl: string;
  status: PreviewSessionStatus;
  previewUrl?: string;
  framework?: SupportedFramework;
  error?: string;
};

export type CodeLocation = {
  file: string;
  lineStart?: number;
  lineEnd?: number;
  functionName?: string;
};

export type PreviewElement = {
  id: string;
  label: string;
  route: string;
  locations: CodeLocation[];
};

export type ArchitectureNode = {
  id: string;
  label: string;
  type: "route" | "component" | "api" | "file";
  locations: CodeLocation[];
  fanIn: number;
  risky: boolean;
};

export type ArchitectureGraph = {
  nodes: ArchitectureNode[];
  edges: { source: string; target: string }[];
};

export type TraceStep = {
  location: CodeLocation;
  explanation: string;
};

export type TraceProvider = "openai" | "local";

export type TraceResult = {
  question: string;
  steps: TraceStep[];
  confidence: "high" | "medium" | "low";
  /** Which engine produced the answer. "local" is the deterministic analyzer. */
  provider?: TraceProvider;
};

export type CreatePreviewRequest = {
  repoUrl: string;
};

/** A single repository file shipped to the browser for in-browser execution. */
export type PreviewFile = {
  path: string;
  contents: string;
  encoding: "utf8" | "base64";
};

/**
 * Everything the browser needs to run a repository inside a WebContainer.
 * The server only fetches and packages source files; it never executes them.
 */
export type PreviewBundle = {
  repoUrl: string;
  projectRoot: string;
  framework: SupportedFramework;
  devCommand: { script: string; args: string[] };
  files: PreviewFile[];
};

/** Client-side lifecycle of the in-browser preview. */
export type BrowserPreviewStatus =
  | "fetching-files"
  | "booting"
  | "installing"
  | "starting"
  | "ready"
  | "failed";

export type AnalyzeRequest = {
  repoUrl: string;
};

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun" | "pip" | "unknown";

export type DetectedFramework =
  | "react"
  | "next"
  | "vite"
  | "vue"
  | "nuxt"
  | "svelte"
  | "astro"
  | "angular"
  | "chrome-extension"
  | "node-cli"
  | "library"
  | "python"
  | "unknown";

export type DetectedSubproject = {
  root: string;
  name: string;
  framework: DetectedFramework;
  packageManager: PackageManager;
  scripts: string[];
  runnable: boolean;
};

export type PreviewCandidate = DetectedSubproject & {
  available: boolean;
  reason: string;
};

export type RepositoryProjectInfo = {
  projectType:
    | "frontend"
    | "monorepo"
    | "library"
    | "cli"
    | "chrome-extension"
    | "python"
    | "backend"
    | "mixed"
    | "unknown";
  frameworks: DetectedFramework[];
  packageManagers: PackageManager[];
  monorepo: boolean;
  subprojects: DetectedSubproject[];
  previewCandidates: PreviewCandidate[];
  previewAvailable: boolean;
  previewReason: string;
  defaultBranch?: string;
  description?: string;
  source: "verified-local" | "github-readonly";
};

/** Heuristic visual role of a detected interface component. */
export type InterfaceRole =
  | "page"
  | "layout"
  | "navigation"
  | "form"
  | "card"
  | "table"
  | "modal"
  | "button"
  | "list"
  | "chart"
  | "media"
  | "control"
  | "widget";

export type InterfaceScreenKind =
  | "page"
  | "route"
  | "popup"
  | "options"
  | "component"
  | "content-script";

/**
 * A previewable screen of the repository's interface: an HTML page, a route
 * component, or a Chrome-extension popup/options page. `previewHtml` is a
 * fully sanitized, script-free document reconstructed from source — it is
 * rendered in a sandboxed iframe and never executes repository code.
 */
export type InterfaceScreen = {
  id: string;
  name: string;
  kind: InterfaceScreenKind;
  route?: string;
  file: string;
  location: CodeLocation;
  componentNames: string[];
  styles: string[];
  assets: string[];
  controls: string[];
  previewHtml: string | null;
  subprojectRoot: string;
};

export type InterfaceComponent = {
  name: string;
  file: string;
  location: CodeLocation;
  role: InterfaceRole;
  previewHtml: string | null;
  subprojectRoot: string;
};

export type InterfaceReport = {
  hasVisualInterface: boolean;
  summary: string;
  message?: string;
  screens: InterfaceScreen[];
  components: InterfaceComponent[];
  styleFiles: string[];
  tailwind: boolean;
  images: string[];
  icons: string[];
};

export type LanguageStat = {
  name: string;
  files: number;
  bytes: number;
  percent: number;
};

export type AnalyzedSourceFile = {
  path: string;
  kind: "entry" | "component" | "service" | "source";
  imports: string[];
  dependents: string[];
  components: string[];
  serviceFunctions: string[];
  entryPoint: boolean;
};

export type AnalyzeResult = {
  analysisId: string;
  sessionId: string;
  repoUrl: string;
  /** Repository name derived from the normalized URL. */
  name: string;
  routes: string[];
  elements: PreviewElement[];
  files: AnalyzedSourceFile[];
  entryPoints: CodeLocation[];
  graph: ArchitectureGraph;
  project: RepositoryProjectInfo;
  languages: LanguageStat[];
  /** Bounded folder-structure outline of the fetched repository. */
  folders: string[];
  importantFiles: string[];
  interface: InterfaceReport;
};

export type TraceRequest = {
  analysisId: string;
  question: string;
};

export type TraceErrorCode =
  | "EMPTY_QUESTION"
  | "MODEL_CONFIGURATION"
  | "MODEL_ERROR"
  | "INVALID_MODEL_OUTPUT"
  | "INVALID_CITATION";
