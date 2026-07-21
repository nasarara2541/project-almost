import { randomUUID } from "node:crypto";
import { analysisSessionManager } from "@/lib/analyzer/analysis-session-manager";
import { isRemoteRepositoryError } from "@/lib/analyzer/github-source";
import { normalizeGitHubRepositoryUrl } from "@/lib/preview/repositories";
import type {
  AnalyzeResult,
  AuditFinding,
  ContributionCheckState,
  ContributionVerification,
  ContributionVerificationStatus,
} from "@/types/api";

const GITHUB_API_VERSION = "2022-11-28";
const FETCH_TIMEOUT_MS = 15_000;
const TRUSTED_REVIEWER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const FAILING_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);

type PullRequestLocation = { owner: string; repo: string; pullNumber: number; normalizedUrl: string };

type PullRequestResponse = {
  html_url: string;
  title: string;
  state: string;
  merged: boolean;
  changed_files: number;
  user?: { login?: string };
  head: { sha: string; repo?: { html_url?: string; full_name?: string } | null };
  base: { repo: { html_url?: string; full_name: string } };
};

type PullFileResponse = { filename: string };

type PullReviewResponse = {
  id: number;
  state: string;
  submitted_at?: string | null;
  author_association?: string;
  user?: { login?: string };
};

type CheckRunsResponse = {
  total_count: number;
  check_runs: { status: string; conclusion?: string | null }[];
};

type CombinedStatusResponse = {
  state: string;
  total_count: number;
  statuses: { state: string }[];
};

export type ContributionStatusEvidence = {
  merged: boolean;
  changesRequested: boolean;
  approved: boolean;
  originalFindingResolved: boolean;
  analysisComplete: boolean;
  relevantFileCount: number;
  newHighFindingCount: number;
  checkState: ContributionCheckState;
};

export class ContributionVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_PR" | "WRONG_REPOSITORY" | "NOT_FOUND" | "NOT_AUTHORIZED" | "GITHUB_ERROR" | "ANALYSIS_FAILED",
  ) {
    super(message);
    this.name = "ContributionVerificationError";
  }
}

export function parsePullRequestUrl(value: string): PullRequestLocation {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ContributionVerificationError("Enter a complete GitHub pull request URL.", "INVALID_PR");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const pullNumber = Number(parts[3]);
  if (
    url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" ||
    parts.length !== 4 || parts[2] !== "pull" || !Number.isSafeInteger(pullNumber) || pullNumber < 1
  ) {
    throw new ContributionVerificationError(
      "Use a GitHub pull request URL such as https://github.com/owner/repository/pull/123.",
      "INVALID_PR",
    );
  }
  return {
    owner: parts[0],
    repo: parts[1],
    pullNumber,
    normalizedUrl: `https://github.com/${parts[0]}/${parts[1]}/pull/${pullNumber}`,
  };
}

export function contributionStatus(evidence: ContributionStatusEvidence): ContributionVerificationStatus {
  if (evidence.merged) return "accepted";
  if (
    evidence.changesRequested || evidence.checkState === "failing" ||
    evidence.newHighFindingCount > 0 ||
    (evidence.analysisComplete && !evidence.originalFindingResolved)
  ) return "needs-work";
  if (evidence.approved) return "approved";
  if (
    evidence.analysisComplete && evidence.originalFindingResolved &&
    evidence.checkState === "passing" && evidence.newHighFindingCount === 0
  ) return "verified";
  if (
    evidence.relevantFileCount > 0 ||
    (evidence.analysisComplete && evidence.originalFindingResolved)
  ) return "implemented";
  return "started";
}

function apiHeaders(accessToken: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "RepoLens-contribution-verifier",
  };
}

async function githubJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: apiHeaders(accessToken),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new ContributionVerificationError(
        "The pull request was not found, or RepoLens is not installed for this repository.",
        "NOT_FOUND",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ContributionVerificationError(
        "RepoLens does not have permission to read this pull request. Check the GitHub App installation and read permissions.",
        "NOT_AUTHORIZED",
      );
    }
    throw new ContributionVerificationError(
      `GitHub returned HTTP ${response.status} while verifying the pull request.`,
      "GITHUB_ERROR",
    );
  }
  return await response.json() as T;
}

async function optionalGithubJson<T>(url: string, accessToken: string): Promise<T | null> {
  try {
    return await githubJson<T>(url, accessToken);
  } catch (error) {
    if (error instanceof ContributionVerificationError && ["NOT_FOUND", "NOT_AUTHORIZED"].includes(error.code)) {
      return null;
    }
    throw error;
  }
}

async function paginatedPullData<T>(
  apiBase: string,
  endpoint: "files" | "reviews",
  accessToken: string,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await githubJson<T[]>(`${apiBase}/${endpoint}?per_page=100&page=${page}`, accessToken);
    items.push(...batch);
    if (batch.length < 100) return { items, truncated: false };
  }
  return { items, truncated: true };
}

function reviewEvidence(reviews: PullReviewResponse[]) {
  const latestByReviewer = new Map<string, PullReviewResponse>();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!login || !TRUSTED_REVIEWER_ASSOCIATIONS.has(review.author_association ?? "")) continue;
    const current = latestByReviewer.get(login);
    const currentTime = current?.submitted_at ?? "";
    const nextTime = review.submitted_at ?? "";
    if (!current || nextTime > currentTime || (nextTime === currentTime && review.id > current.id)) {
      latestByReviewer.set(login, review);
    }
  }
  const latest = [...latestByReviewer.entries()];
  return {
    approved: latest.some(([, review]) => review.state.toUpperCase() === "APPROVED"),
    changesRequested: latest.some(([, review]) => review.state.toUpperCase() === "CHANGES_REQUESTED"),
    approvers: latest
      .filter(([, review]) => review.state.toUpperCase() === "APPROVED")
      .map(([login]) => login)
      .sort(),
  };
}

function checkEvidence(checkRuns: CheckRunsResponse | null, commitStatus: CombinedStatusResponse | null) {
  const states: ("passed" | "failed" | "pending")[] = [];
  for (const run of checkRuns?.check_runs ?? []) {
    if (run.status !== "completed" || !run.conclusion) states.push("pending");
    else if (PASSING_CONCLUSIONS.has(run.conclusion)) states.push("passed");
    else if (FAILING_CONCLUSIONS.has(run.conclusion)) states.push("failed");
    else states.push("pending");
  }
  for (const status of commitStatus?.statuses ?? []) {
    if (status.state === "success") states.push("passed");
    else if (["failure", "error"].includes(status.state)) states.push("failed");
    else states.push("pending");
  }
  const failed = states.filter((state) => state === "failed").length;
  const pending = states.filter((state) => state === "pending").length;
  const passed = states.filter((state) => state === "passed").length;
  const state: ContributionCheckState = states.length === 0
    ? "not-found"
    : failed > 0
      ? "failing"
      : pending > 0
        ? "pending"
        : "passing";
  return { state, total: states.length, passed, failed, pending };
}

function repoNameFromUrl(repoUrl: string) {
  return normalizeGitHubRepositoryUrl(repoUrl).toLowerCase();
}

async function analyzePullHead(
  pull: PullRequestResponse,
  targetRepoUrl: string,
  accessToken: string,
): Promise<AnalyzeResult> {
  const headRepoUrl = pull.head.repo?.html_url || targetRepoUrl;
  try {
    return await analysisSessionManager.create(headRepoUrl, { accessToken, commitSha: pull.head.sha });
  } catch (error) {
    if (headRepoUrl !== targetRepoUrl && isRemoteRepositoryError(error)) {
      try {
        return await analysisSessionManager.create(targetRepoUrl, { accessToken, commitSha: pull.head.sha });
      } catch (fallbackError) {
        if (isRemoteRepositoryError(fallbackError)) {
          throw new ContributionVerificationError(fallbackError.message, "ANALYSIS_FAILED");
        }
        throw fallbackError;
      }
    }
    if (isRemoteRepositoryError(error)) {
      throw new ContributionVerificationError(error.message, "ANALYSIS_FAILED");
    }
    throw error;
  }
}

export async function verifyContribution(input: {
  analysis: AnalyzeResult;
  finding: AuditFinding;
  pullRequestUrl: string;
  accessToken: string;
  existing?: ContributionVerification | null;
}): Promise<ContributionVerification> {
  const location = parsePullRequestUrl(input.pullRequestUrl);
  const expectedRepo = repoNameFromUrl(input.analysis.repoUrl);
  const actualRepo = `https://github.com/${location.owner}/${location.repo}`.toLowerCase();
  if (expectedRepo !== actualRepo) {
    throw new ContributionVerificationError(
      "That pull request belongs to a different repository than this RepoLens analysis.",
      "WRONG_REPOSITORY",
    );
  }

  const apiBase = `https://api.github.com/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}`;
  const pullApi = `${apiBase}/pulls/${location.pullNumber}`;
  const [pull, filesResult, reviewsResult] = await Promise.all([
    githubJson<PullRequestResponse>(pullApi, input.accessToken),
    paginatedPullData<PullFileResponse>(pullApi, "files", input.accessToken),
    paginatedPullData<PullReviewResponse>(pullApi, "reviews", input.accessToken),
  ]);
  if (pull.base.repo.full_name.toLowerCase() !== `${location.owner}/${location.repo}`.toLowerCase()) {
    throw new ContributionVerificationError("GitHub returned a pull request for an unexpected repository.", "WRONG_REPOSITORY");
  }

  const encodedSha = encodeURIComponent(pull.head.sha);
  const [checkRuns, commitStatus] = await Promise.all([
    optionalGithubJson<CheckRunsResponse>(`${apiBase}/commits/${encodedSha}/check-runs?per_page=100`, input.accessToken),
    optionalGithubJson<CombinedStatusResponse>(`${apiBase}/commits/${encodedSha}/status?per_page=100`, input.accessToken),
  ]);
  const checks = checkEvidence(checkRuns, commitStatus);
  const review = reviewEvidence(reviewsResult.items);
  const changedFiles = filesResult.items.map((file) => file.filename).sort();
  const expectedFiles = new Set(input.finding.files);
  const relevantFiles = changedFiles.filter((file) => expectedFiles.has(file));
  const originalHighFindingIds = new Set(
    input.analysis.audit.findings.filter((finding) => finding.severity === "high").map((finding) => finding.id),
  );

  let headAnalysis: AnalyzeResult | null = null;
  try {
    headAnalysis = await analyzePullHead(pull, `https://github.com/${location.owner}/${location.repo}`, input.accessToken);
    const originalFindingResolved = !headAnalysis.audit.findings.some((finding) => finding.id === input.finding.id);
    const newHighFindings = headAnalysis.audit.findings
      .filter((finding) => finding.severity === "high" && !originalHighFindingIds.has(finding.id))
      .map((finding) => ({ id: finding.id, title: finding.title }));
    const analysisComplete = headAnalysis.audit.coverage.complete;
    const status = contributionStatus({
      merged: pull.merged,
      changesRequested: review.changesRequested,
      approved: review.approved,
      originalFindingResolved,
      analysisComplete,
      relevantFileCount: relevantFiles.length,
      newHighFindingCount: newHighFindings.length,
      checkState: checks.state,
    });
    const limitations = [...headAnalysis.audit.coverage.limitations];
    if (!checkRuns) limitations.push("GitHub check runs could not be read; grant the GitHub App Checks: read permission.");
    if (!commitStatus) limitations.push("Commit statuses could not be read; grant the GitHub App Commit statuses: read permission.");
    if (checks.state === "not-found") limitations.push("No CI checks or commit statuses were reported for the pull request head commit.");
    if (filesResult.truncated || pull.changed_files > changedFiles.length) {
      limitations.push(`The pull request changes more than ${changedFiles.length} files; file relevance is based on the first ${changedFiles.length}.`);
    }
    if (reviewsResult.truncated) limitations.push("Review evidence is based on the first 300 review records.");
    const now = new Date().toISOString();
    return {
      id: input.existing?.id ?? randomUUID(),
      analysisId: input.analysis.analysisId,
      findingId: input.finding.id,
      pullRequestUrl: pull.html_url || location.normalizedUrl,
      owner: location.owner,
      repo: location.repo,
      pullNumber: location.pullNumber,
      status,
      title: pull.title,
      author: pull.user?.login ?? "unknown",
      headSha: pull.head.sha,
      changedFiles,
      relevantFiles,
      originalFindingResolved,
      analysisComplete,
      newHighFindings,
      checks,
      review,
      merged: pull.merged,
      limitations: [...new Set(limitations)],
      needsRefresh: false,
      createdAt: input.existing?.createdAt ?? now,
      lastVerifiedAt: now,
    };
  } finally {
    if (headAnalysis) await analysisSessionManager.delete(headAnalysis.analysisId);
  }
}
