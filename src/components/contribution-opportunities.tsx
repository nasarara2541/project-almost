"use client";

import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { focusMatchesFinding, rankContributionMatches } from "@/lib/audit/contribution-matcher";
import { createAuditMarkdown } from "@/lib/audit/markdown-report";
import type {
  AnalyzeResult,
  AuditCategory,
  AuditFinding,
  ContributionFeedbackRecord,
  ContributionVerification,
  ContributorProfile,
  FeedbackVerdict,
} from "@/types/api";

const experienceLabels = {
  new: "new contributor",
  comfortable: "comfortable contributor",
  advanced: "experienced maintainer",
};

const timeLabels = {
  "half-hour": "about 30 minutes",
  "two-hours": "a couple of hours",
  weekend: "a weekend",
};

const focusLabels = {
  any: "best overall fit",
  docs: "docs and community",
  tests: "tests and CI",
  cleanup: "cleanup and dead code",
  frontend: "frontend and accessibility",
};

const categoryLabels: Record<AuditCategory, string> = {
  community: "Community",
  "developer-experience": "Developer experience",
  "documentation-quality": "Documentation quality",
  testing: "Testing & CI",
  maintainability: "Maintainability",
  "frontend-quality": "Frontend quality",
};

const estimatedTime: Record<AuditFinding["difficulty"], string> = {
  "quick-win": "Under 1 hour",
  moderate: "1–3 hours",
  substantial: "A focused weekend",
};

const verificationLabels: Record<ContributionVerification["status"], string> = {
  suggested: "Suggested",
  started: "PR linked",
  implemented: "Change detected",
  verified: "Evidence verified",
  approved: "Maintainer approved",
  accepted: "Merged",
  "needs-work": "Needs work",
};

const checkLabels: Record<ContributionVerification["checks"]["state"], string> = {
  passing: "Passing",
  failing: "Failing",
  pending: "Pending",
  "not-found": "No checks found",
};

function githubFileUrl(repoUrl: string, branch: string | undefined, file: string, line?: number) {
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  return `${repoUrl}/blob/${encodeURIComponent(branch ?? "HEAD")}/${encoded}${line ? `#L${line}` : ""}`;
}

function matchReasons(finding: AuditFinding, profile: ContributorProfile) {
  const reasons: string[] = [];
  const timeFits = profile.time === "weekend"
    || (profile.time === "two-hours" && finding.difficulty !== "substantial")
    || (profile.time === "half-hour" && finding.difficulty === "quick-win");
  if (timeFits) reasons.push(`Fits ${timeLabels[profile.time]}`);
  if (profile.focus !== "any" && focusMatchesFinding(finding, profile)) {
    reasons.push(`Matches ${focusLabels[profile.focus]}`);
  }
  reasons.push(`${finding.confidence}-confidence evidence`);
  return reasons.slice(0, 3);
}

export function ContributionOpportunities({
  analysis,
  profile,
  signedIn,
  initialFeedback,
  onAnalyzeRealRepository,
}: {
  analysis: AnalyzeResult;
  profile: ContributorProfile;
  signedIn: boolean;
  initialFeedback: ContributionFeedbackRecord[];
  onAnalyzeRealRepository: () => void;
}) {
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);
  const [feedbackByFinding, setFeedbackByFinding] = useState<Record<string, FeedbackVerdict>>(
    Object.fromEntries(initialFeedback.map((item) => [item.findingId, item.verdict])),
  );
  const [falsePositiveId, setFalsePositiveId] = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [verificationByFinding, setVerificationByFinding] = useState<Record<string, ContributionVerification>>({});
  const [pullRequestByFinding, setPullRequestByFinding] = useState<Record<string, string>>({});
  const [verifyingFindingId, setVerifyingFindingId] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const linksToGitHub = analysis.project.source === "github-readonly";
  const matches = useMemo(() => {
    return rankContributionMatches(
      analysis.audit.findings,
      analysis.audit.opportunities,
      profile,
    );
  }, [analysis.audit.findings, analysis.audit.opportunities, profile]);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void fetch(`/api/contributions?analysisId=${encodeURIComponent(analysis.analysisId)}`, {
      signal: controller.signal,
      cache: "no-store",
    }).then(async (response) => {
      const body = await response.json() as { contributions?: ContributionVerification[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Tracked contributions could not be loaded.");
      setVerificationByFinding(Object.fromEntries(
        (body.contributions ?? []).map((item) => [item.findingId, item]),
      ));
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setVerificationError(error instanceof Error ? error.message : "Tracked contributions could not be loaded.");
    });
    return () => controller.abort();
  }, [analysis.analysisId, signedIn]);

  function downloadReport() {
    const blob = new Blob([createAuditMarkdown(analysis)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${analysis.name.replace(/[^a-z0-9_-]+/gi, "-")}-repolens-evidence.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function submitFeedback(findingId: string, verdict: FeedbackVerdict, note?: string) {
    setFeedbackError(null);
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysisId: analysis.analysisId, findingId, verdict, note }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) {
      setFeedbackError(body.error ?? "Feedback could not be saved.");
      return;
    }
    setFeedbackByFinding((current) => ({ ...current, [findingId]: verdict }));
    setFalsePositiveId(null);
    setFeedbackNote("");
  }

  async function verifyPullRequest(findingId: string, existing?: ContributionVerification) {
    setVerificationError(null);
    setVerifyingFindingId(findingId);
    try {
      const response = await fetch(
        existing ? `/api/contributions/${encodeURIComponent(existing.id)}/verify` : "/api/contributions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: existing ? undefined : JSON.stringify({
            analysisId: analysis.analysisId,
            findingId,
            pullRequestUrl: pullRequestByFinding[findingId] ?? "",
          }),
        },
      );
      const body = await response.json() as { contribution?: ContributionVerification; error?: string };
      if (!response.ok || !body.contribution) {
        setVerificationError(body.error ?? "The pull request could not be verified.");
        return;
      }
      setVerificationByFinding((current) => ({ ...current, [findingId]: body.contribution as ContributionVerification }));
      setPullRequestByFinding((current) => ({ ...current, [findingId]: "" }));
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : "The pull request could not be verified.");
    } finally {
      setVerifyingFindingId(null);
    }
  }

  return (
    <section className="contribution-opportunities contribution-matches" aria-labelledby="opportunities-heading">
      <div className="match-hero">
        <div>
          <p className="section-label">Your best matches</p>
          <h2 id="opportunities-heading">
            {matches.length > 0
              ? `${matches.length} contribution${matches.length === 1 ? "" : "s"} worth starting`
              : "No reliable match yet"}
          </h2>
          <p>
            Ranked for a {experienceLabels[profile.experience]} with {timeLabels[profile.time]},
            focused on {focusLabels[profile.focus]}.
          </p>
        </div>
        <div className="match-hero__actions">
          <span>{analysis.audit.coverage.coveragePercent}% of supported files checked</span>
          <button type="button" className="report-download" onClick={downloadReport}>Download evidence</button>
        </div>
      </div>

      {matches.length > 0 ? (
        <div className="match-list">
          {matches.map((finding, index) => {
            const isExpanded = expandedFindingId === finding.id;
            const detailsId = `match-details-${finding.id.replace(/[^a-z0-9_-]+/gi, "-")}`;
            const issueBody = [
              "## Suggested contribution",
              finding.contributionTask,
              "",
              "## Why this matters",
              finding.whyItMatters,
              "",
              "## Evidence",
              ...finding.evidence.map((item) => `- ${item.label}: ${item.value}`),
              "",
              finding.limitation ? `> Verification note: ${finding.limitation}` : "",
              "",
              "Generated as a starting point by RepoLens. Please verify with a maintainer before implementation.",
            ].filter(Boolean).join("\n");
            const issueUrl = `${analysis.repoUrl}/issues/new?title=${encodeURIComponent(finding.title)}&body=${encodeURIComponent(issueBody)}`;
            const verification = verificationByFinding[finding.id];
            const isVerifying = verifyingFindingId === finding.id;

            return (
              <article key={finding.id} className={`match-card ${index === 0 ? "match-card--best" : ""} ${isExpanded ? "is-expanded" : ""}`}>
                <div className="match-card__rank">
                  <span>{index === 0 ? "Best match" : `Match ${index + 1}`}</span>
                  <strong>{String(index + 1).padStart(2, "0")}</strong>
                </div>
                <div className="match-card__main">
                  <div className="match-card__meta">
                    <span>{estimatedTime[finding.difficulty]}</span>
                    <span>{categoryLabels[finding.category]}</span>
                    <span className={`confidence-badge confidence-badge--${finding.confidence}`}>
                      {finding.confidence} confidence
                    </span>
                  </div>
                  <h3>{finding.title}</h3>
                  <p>{finding.recommendation}</p>
                  <ul className="match-reasons" aria-label="Why this task matches">
                    {matchReasons(finding, profile).map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                  <div className="contributor-validation">
                    <strong>
                      {feedbackByFinding[finding.id]
                        ? `Your feedback: ${feedbackByFinding[finding.id].replace("-", " ")}`
                        : "Your feedback (self-reported)"}
                    </strong>
                    {signedIn ? (
                      <div>
                        <button type="button" onClick={() => void submitFeedback(finding.id, "useful")}>Useful</button>
                        <button type="button" onClick={() => void submitFeedback(finding.id, "started")}>I started it</button>
                        <button type="button" onClick={() => void submitFeedback(finding.id, "completed")}>Completed</button>
                        <button type="button" onClick={() => setFalsePositiveId(finding.id)}>Not accurate</button>
                        <button type="button" onClick={() => void submitFeedback(finding.id, "not-relevant")}>Not for me</button>
                      </div>
                    ) : <a href="/api/auth/github?returnTo=%2F%23opportunities">Sign in to save progress</a>}
                    {falsePositiveId === finding.id ? (
                      <form onSubmit={(event) => {
                        event.preventDefault();
                        void submitFeedback(finding.id, "inaccurate", feedbackNote);
                      }}>
                        <label htmlFor={`feedback-note-${finding.id}`}>What did RepoLens get wrong?</label>
                        <textarea
                          id={`feedback-note-${finding.id}`}
                          value={feedbackNote}
                          onChange={(event) => setFeedbackNote(event.target.value)}
                          maxLength={1000}
                          placeholder="For example: this file is loaded dynamically by the router."
                          required
                        />
                        <button type="submit">Send correction</button>
                      </form>
                    ) : null}
                  </div>

                  <div className="contribution-verification">
                    <div className="contribution-verification__heading">
                      <div>
                        <strong>{verification ? "Contribution verification" : "Turn this task into a verified contribution"}</strong>
                        <span>
                          {verification
                            ? "RepoLens checks the code change, CI, review, and merge evidence."
                            : "First make the change and open a pull request on GitHub. Then RepoLens can verify the evidence."}
                        </span>
                      </div>
                      {verification ? (
                        <span className={`verification-status verification-status--${verification.status}`}>
                          {verificationLabels[verification.status]}
                        </span>
                      ) : null}
                    </div>
                    {!signedIn ? (
                      <p className="verification-signin">
                        <a href="/api/auth/github?returnTo=%2F%23opportunities">Sign in with GitHub</a> to verify a pull request.
                      </p>
                    ) : !linksToGitHub ? (
                      <div className="verification-demo-notice">
                        <strong>You are viewing the sample report</strong>
                        <p>
                          This demo is analyzed from a local snapshot, so it has no real GitHub pull
                          request to verify. Analyze a repository where RepoLens is installed to link a PR.
                        </p>
                        <button type="button" onClick={onAnalyzeRealRepository}>
                          Analyze my GitHub repository
                        </button>
                      </div>
                    ) : verification ? (
                      <div className="verification-result">
                        {verification.needsRefresh ? (
                          <p className="verification-refresh-note">GitHub reported a new PR event. Refresh the evidence below.</p>
                        ) : null}
                        <div className="verification-result__pr">
                          <a href={verification.pullRequestUrl} target="_blank" rel="noreferrer">
                            #{verification.pullNumber} {verification.title} ↗
                          </a>
                          <span>by @{verification.author} · commit {verification.headSha.slice(0, 7)}</span>
                        </div>
                        <dl className="verification-evidence">
                          <div className={verification.originalFindingResolved ? "is-positive" : "is-negative"}>
                            <dt>Original finding</dt>
                            <dd>{verification.analysisComplete
                              ? verification.originalFindingResolved ? "No longer detected" : "Still detected"
                              : "Result incomplete"}</dd>
                          </div>
                          <div className={`is-${verification.checks.state}`}>
                            <dt>CI & checks</dt>
                            <dd>{checkLabels[verification.checks.state]}</dd>
                            <small>{verification.checks.passed} passed · {verification.checks.failed} failed · {verification.checks.pending} pending</small>
                          </div>
                          <div className={verification.review.approved ? "is-positive" : verification.review.changesRequested ? "is-negative" : ""}>
                            <dt>Maintainer review</dt>
                            <dd>{verification.review.changesRequested
                              ? "Changes requested"
                              : verification.review.approved
                                ? `Approved${verification.review.approvers.length ? ` by ${verification.review.approvers.map((login) => `@${login}`).join(", ")}` : ""}`
                                : "Not approved yet"}</dd>
                          </div>
                          <div className={verification.merged ? "is-positive" : ""}>
                            <dt>Repository decision</dt>
                            <dd>{verification.merged ? "Merged" : "Not merged"}</dd>
                          </div>
                        </dl>
                        <div className="verification-change-summary">
                          <span><strong>{verification.changedFiles.length}</strong> files changed</span>
                          <span><strong>{verification.relevantFiles.length}</strong> expected files touched</span>
                          <span><strong>{verification.newHighFindings.length}</strong> new high-priority findings</span>
                        </div>
                        {verification.newHighFindings.length > 0 ? (
                          <p className="verification-warning">
                            New high-priority evidence: {verification.newHighFindings.map((item) => item.title).join("; ")}
                          </p>
                        ) : null}
                        <details className="verification-method">
                          <summary>What RepoLens verified and could not verify</summary>
                          <p>Static analysis was rerun on the exact PR head commit. Automated checks and trusted repository reviews came from GitHub.</p>
                          <ul>{verification.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
                        </details>
                        <div className="verification-result__footer">
                          <span>Last checked <time dateTime={verification.lastVerifiedAt}>{verification.lastVerifiedAt.slice(0, 10)}</time></span>
                          <button type="button" disabled={isVerifying} onClick={() => void verifyPullRequest(finding.id, verification)}>
                            {isVerifying ? "Checking PR evidence…" : verification.needsRefresh ? "Update verification" : "Verify again"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="verification-start">
                        <ol className="verification-steps" aria-label="How to verify this contribution">
                          <li>
                            <span>1</span>
                            <div><strong>Review the task</strong><p>Use “Review evidence” and “Copy” on this card.</p></div>
                          </li>
                          <li>
                            <span>2</span>
                            <div>
                              <strong>Make the change on GitHub</strong>
                              <p>Work in a new branch or fork, commit it, then open a pull request.</p>
                              <a href={analysis.repoUrl} target="_blank" rel="noreferrer">Open repository ↗</a>
                            </div>
                          </li>
                          <li>
                            <span>3</span>
                            <div><strong>Bring the PR back here</strong><p>Copy the pull request URL from GitHub and paste it below.</p></div>
                          </li>
                        </ol>
                        <form className="verification-form" onSubmit={(event) => {
                          event.preventDefault();
                          void verifyPullRequest(finding.id);
                        }}>
                          <label htmlFor={`pull-request-${finding.id}`}>Already opened the PR? Paste its URL</label>
                          <div>
                            <input
                              id={`pull-request-${finding.id}`}
                              type="url"
                              inputMode="url"
                              placeholder={`${analysis.repoUrl}/pull/12`}
                              value={pullRequestByFinding[finding.id] ?? ""}
                              onChange={(event) => setPullRequestByFinding((current) => ({
                                ...current,
                                [finding.id]: event.target.value,
                              }))}
                              required
                            />
                            <button type="submit" disabled={isVerifying}>
                              {isVerifying ? "Checking PR evidence…" : "Verify this PR"}
                            </button>
                          </div>
                          <small>Paste a real GitHub PR—not the repository URL. RepoLens only reads it and never writes to GitHub.</small>
                        </form>
                      </div>
                    )}
                  </div>
                </div>
                <div className="match-card__actions">
                  <button
                    type="button"
                    className="opportunity-card__toggle"
                    aria-expanded={isExpanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedFindingId(isExpanded ? null : finding.id)}
                  >
                    {isExpanded ? "Hide evidence" : "Review evidence"}
                  </button>
                  <CopyButton value={finding.contributionTask} label="Contribution task" />
                  {linksToGitHub ? <a href={issueUrl} target="_blank" rel="noreferrer">Draft GitHub issue ↗</a> : null}
                </div>

                {isExpanded ? (
                  <div className="match-card__details" id={detailsId}>
                    <div className="match-task">
                      <strong>Suggested task</strong>
                      <p>{finding.contributionTask}</p>
                    </div>
                    <div className="match-evidence">
                      <div>
                        <strong>Why it matters</strong>
                        <p>{finding.whyItMatters}</p>
                      </div>
                      <div>
                        <strong>Evidence checked</strong>
                        <ul>
                          {finding.evidence.map((item, evidenceIndex) => (
                            <li key={`${item.label}:${evidenceIndex}`}>
                              <span>{item.label}</span>
                              <b>{item.value}</b>
                              {item.location && linksToGitHub ? (
                                <a href={githubFileUrl(analysis.repoUrl, analysis.project.defaultBranch, item.location.file, item.location.lineStart)} target="_blank" rel="noreferrer">
                                  {item.location.file}{item.location.lineStart ? `:${item.location.lineStart}` : ""} ↗
                                </a>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    {finding.files.length > 0 ? (
                      <div className="match-files">
                        <strong>Files to inspect first</strong>
                        <div>{finding.files.map((file) => linksToGitHub ? (
                          <a key={file} href={githubFileUrl(analysis.repoUrl, analysis.project.defaultBranch, file)} target="_blank" rel="noreferrer">{file} ↗</a>
                        ) : <code key={file}>{file}</code>)}</div>
                      </div>
                    ) : null}
                    {finding.limitation ? (
                      <p className="match-limitation"><strong>Verify before changing code:</strong> {finding.limitation}</p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-filter-state">
          <strong>RepoLens did not find a task it can recommend confidently.</strong>
          <p>That is more useful than inventing work. Review all findings or try a larger repository.</p>
        </div>
      )}
      {feedbackError ? <p className="feedback-error" role="alert">{feedbackError}</p> : null}
      {verificationError ? <p className="feedback-error" role="alert">{verificationError}</p> : null}
    </section>
  );
}
