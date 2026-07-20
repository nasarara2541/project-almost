"use client";

import { useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import type { AnalyzeResult, AuditCategory, AuditSeverity } from "@/types/api";

const categoryLabels: Record<AuditCategory, string> = {
  community: "Community",
  "developer-experience": "Developer experience",
  testing: "Testing & CI",
  maintainability: "Maintainability",
  "frontend-quality": "Frontend quality",
};

const severityLabels: Record<AuditSeverity, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
  info: "Coverage note",
};

function githubFileUrl(repoUrl: string, branch: string | undefined, file: string, line?: number): string {
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  return `${repoUrl}/blob/${encodeURIComponent(branch ?? "HEAD")}/${encoded}${line ? `#L${line}` : ""}`;
}

export function AuditFindings({ analysis }: { analysis: AnalyzeResult }) {
  const [category, setCategory] = useState<AuditCategory | "all">("all");
  const [severity, setSeverity] = useState<AuditSeverity | "all">("all");
  const [query, setQuery] = useState("");
  const findings = useMemo(() => {
    const target = query.trim().toLowerCase();
    return analysis.audit.findings.filter((finding) => {
      if (category !== "all" && finding.category !== category) return false;
      if (severity !== "all" && finding.severity !== severity) return false;
      if (!target) return true;
      return [finding.title, finding.summary, finding.recommendation, ...finding.files]
        .join(" ")
        .toLowerCase()
        .includes(target);
    });
  }, [analysis.audit.findings, category, query, severity]);
  const linksToGitHub = analysis.project.source === "github-readonly";

  return (
    <section className="audit-findings" aria-labelledby="audit-findings-heading">
      <div className="results-section-heading">
        <span className="step-number">02</span>
        <div>
          <p className="section-label">Evidence-backed gaps</p>
          <h2 id="audit-findings-heading">What deserves attention</h2>
          <p>Every finding names its evidence, confidence, limits, and a concrete next action.</p>
        </div>
      </div>

      <div className="finding-toolbar">
        <label>
          <span>Search findings</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files, gaps, or actions" />
        </label>
        <label>
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as AuditCategory | "all")}>
            <option value="all">All categories</option>
            {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select value={severity} onChange={(event) => setSeverity(event.target.value as AuditSeverity | "all")}>
            <option value="all">All priorities</option>
            {Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {findings.length > 0 ? (
        <div className="finding-list">
          {findings.map((finding, index) => (
            <article key={finding.id} className={`finding-card finding-card--${finding.severity}`}>
              <div className="finding-card__topline">
                <span className={`severity-pill severity-pill--${finding.severity}`}>{severityLabels[finding.severity]}</span>
                <span>{categoryLabels[finding.category]}</span>
                <span>{finding.confidence} confidence</span>
                <span>{finding.difficulty.replace("-", " ")}</span>
              </div>
              <div className="finding-card__heading">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{finding.title}</h3><p>{finding.summary}</p></div>
              </div>

              <div className="finding-explanation">
                <div><strong>Why it matters</strong><p>{finding.whyItMatters}</p></div>
                <div><strong>Recommended action</strong><p>{finding.recommendation}</p></div>
              </div>

              <details className="finding-evidence" open={finding.id === "maintainability:possibly-unreferenced"}>
                <summary>Review evidence ({finding.evidence.length})</summary>
                <ul>
                  {finding.evidence.map((item, evidenceIndex) => (
                    <li key={`${item.label}:${item.value}:${evidenceIndex}`}>
                      <span className={`evidence-status evidence-status--${item.status}`} />
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.value}</span>
                        {item.location && linksToGitHub ? (
                          <a href={githubFileUrl(analysis.repoUrl, analysis.project.defaultBranch, item.location.file, item.location.lineStart)} target="_blank" rel="noreferrer">
                            {item.location.file}{item.location.lineStart ? `:${item.location.lineStart}` : ""} ↗
                          </a>
                        ) : item.location ? <code>{item.location.file}{item.location.lineStart ? `:${item.location.lineStart}` : ""}</code> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>

              {finding.files.length > 0 ? (
                <div className="finding-files">
                  <strong>Named files</strong>
                  <div>
                    {finding.files.map((file) => linksToGitHub ? (
                      <a key={file} href={githubFileUrl(analysis.repoUrl, analysis.project.defaultBranch, file)} target="_blank" rel="noreferrer">{file} ↗</a>
                    ) : <code key={file}>{file}</code>)}
                  </div>
                </div>
              ) : null}

              {finding.limitation ? <p className="finding-limitation"><strong>Reliability note:</strong> {finding.limitation}</p> : null}

              <div className="contribution-task">
                <div><strong>Contribution task</strong><p>{finding.contributionTask}</p></div>
                <CopyButton value={finding.contributionTask} label="Contribution task" />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-filter-state"><strong>No findings match these filters.</strong><p>Clear the search or choose another category.</p></div>
      )}
    </section>
  );
}
