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
 * fully sanitized, script-free document reconstructed from source. It is
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

export type AuditCategory =
  | "community"
  | "developer-experience"
  | "testing"
  | "maintainability"
  | "frontend-quality";

export type AuditSeverity = "high" | "medium" | "low" | "info";
export type AuditConfidence = "high" | "medium" | "low";
export type ContributionDifficulty = "quick-win" | "moderate" | "substantial";

export type ContributorExperience = "new" | "comfortable" | "advanced";
export type ContributionTime = "half-hour" | "two-hours" | "weekend";
export type ContributionFocus = "any" | "docs" | "tests" | "cleanup" | "frontend";

export type ContributorProfile = {
  experience: ContributorExperience;
  time: ContributionTime;
  focus: ContributionFocus;
};

export type FeedbackVerdict = "useful" | "started" | "completed" | "inaccurate" | "not-relevant";

export type AnalysisComparison = {
  previousAnalysisId: string;
  currentAnalysisId: string;
  added: { id: string; title: string }[];
  resolved: { id: string; title: string }[];
  unchangedCount: number;
};

export type SessionUser = {
  id: string;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

export type SavedAnalysisSummary = {
  id: string;
  repoUrl: string;
  name: string;
  isPrivate: boolean;
  createdAt: string;
  parentId: string | null;
  findingCount: number;
  opportunityCount: number;
  coveragePercent: number;
};

export type GithubRepositoryOption = {
  name: string;
  url: string;
  private: boolean;
  updatedAt: string;
};

export type ContributionFeedbackRecord = {
  findingId: string;
  verdict: FeedbackVerdict;
  note: string | null;
  updatedAt: string;
};

export type ContributionVerificationStatus =
  | "suggested"
  | "started"
  | "implemented"
  | "verified"
  | "approved"
  | "accepted"
  | "needs-work";

export type ContributionCheckState = "passing" | "failing" | "pending" | "not-found";

export type ContributionVerification = {
  id: string;
  analysisId: string;
  findingId: string;
  pullRequestUrl: string;
  owner: string;
  repo: string;
  pullNumber: number;
  status: ContributionVerificationStatus;
  title: string;
  author: string;
  headSha: string;
  changedFiles: string[];
  relevantFiles: string[];
  originalFindingResolved: boolean;
  analysisComplete: boolean;
  newHighFindings: { id: string; title: string }[];
  checks: {
    state: ContributionCheckState;
    total: number;
    passed: number;
    failed: number;
    pending: number;
  };
  review: {
    approved: boolean;
    changesRequested: boolean;
    approvers: string[];
  };
  merged: boolean;
  limitations: string[];
  needsRefresh: boolean;
  createdAt: string;
  lastVerifiedAt: string;
};

export type AuditEvidence = {
  label: string;
  value: string;
  status: "present" | "missing" | "signal";
  location?: CodeLocation;
};

export type AuditFinding = {
  id: string;
  category: AuditCategory;
  severity: AuditSeverity;
  confidence: AuditConfidence;
  title: string;
  summary: string;
  whyItMatters: string;
  recommendation: string;
  evidence: AuditEvidence[];
  files: string[];
  difficulty: ContributionDifficulty;
  contributionTask: string;
  limitation?: string;
};

export type AuditStrength = {
  id: string;
  category: AuditCategory;
  title: string;
  evidence: string;
};

export type AuditCategoryScore = {
  category: AuditCategory;
  score: number;
  findingCount: number;
};

export type SkippedRepositoryFile = {
  path: string;
  size: number;
  reason: "oversized" | "fetch-failed" | "unsupported";
};

export type AnalysisCoverage = {
  repositoryFiles: number;
  supportedFiles: number;
  fetchedFiles: number;
  analyzedSourceFiles: number;
  skippedFiles: SkippedRepositoryFile[];
  coveragePercent: number;
  complete: boolean;
  limitations: string[];
};

export type ContributionOpportunity = {
  id: string;
  findingId: string;
  title: string;
  impact: AuditSeverity;
  difficulty: ContributionDifficulty;
  summary: string;
  task: string;
  files: string[];
};

export type RepositoryAudit = {
  score: number;
  status: "strong" | "solid" | "needs-attention" | "significant-gaps";
  headline: string;
  summary: string;
  categoryScores: AuditCategoryScore[];
  findings: AuditFinding[];
  strengths: AuditStrength[];
  opportunities: ContributionOpportunity[];
  coverage: AnalysisCoverage;
  generatedAt: string;
};

export type AnalyzeResult = {
  analysisId: string;
  sessionId: string;
  repoUrl: string;
  repositoryVisibility: "public" | "private";
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
  audit: RepositoryAudit;
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
