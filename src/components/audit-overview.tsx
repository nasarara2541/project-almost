"use client";

import { createAuditMarkdown } from "@/lib/audit/markdown-report";
import type { AnalyzeResult, AuditCategory } from "@/types/api";

const categoryLabels: Record<AuditCategory, string> = {
  community: "Community",
  "developer-experience": "Developer experience",
  testing: "Testing & CI",
  maintainability: "Maintainability",
  "frontend-quality": "Frontend quality",
};

const statusLabels = {
  strong: "Strong",
  solid: "Solid",
  "needs-attention": "Needs attention",
  "significant-gaps": "Significant gaps",
};

export function AuditOverview({ analysis }: { analysis: AnalyzeResult }) {
  const { audit } = analysis;
  const highPriority = audit.findings.filter((finding) => finding.severity === "high").length;

  function downloadReport() {
    const blob = new Blob([createAuditMarkdown(analysis)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${analysis.name.replace(/[^a-z0-9_-]+/gi, "-")}-repolens-audit.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="audit-overview" aria-labelledby="audit-overview-heading">
      <div className="audit-overview__header">
        <div>
          <p className="section-label">Start here</p>
          <h2 id="audit-overview-heading">{audit.headline}</h2>
          <p>{audit.summary}</p>
        </div>
        <button type="button" className="report-download" onClick={downloadReport}>
          Download Markdown report
        </button>
      </div>

      <div className="audit-scorecard">
        <div className={`audit-score audit-score--${audit.status}`}>
          <span>{audit.score}</span>
          <small>/100</small>
          <strong>{statusLabels[audit.status]}</strong>
          <p>Transparent readiness score based on the findings shown below.</p>
        </div>
        <div className="audit-key-metrics">
          <div><strong>{highPriority}</strong><span>High-priority gaps</span></div>
          <div><strong>{audit.findings.filter((item) => item.severity !== "info").length}</strong><span>Actionable findings</span></div>
          <div><strong>{audit.opportunities.length}</strong><span>Contribution opportunities</span></div>
          <div><strong>{audit.coverage.coveragePercent}%</strong><span>Supported-file coverage</span></div>
        </div>
      </div>

      <div className="category-score-grid">
        {audit.categoryScores.map((category) => (
          <div key={category.category} className="category-score">
            <div>
              <strong>{categoryLabels[category.category]}</strong>
              <span>{category.findingCount} finding{category.findingCount === 1 ? "" : "s"}</span>
            </div>
            <div className="category-score__track" aria-label={`${categoryLabels[category.category]} score ${category.score} out of 100`}>
              <span style={{ width: `${category.score}%` }} />
            </div>
            <b>{category.score}</b>
          </div>
        ))}
      </div>

      <details className="coverage-disclosure">
        <summary>
          <span>Analysis coverage</span>
          <strong>{audit.coverage.fetchedFiles} of {audit.coverage.supportedFiles} supported files fetched</strong>
        </summary>
        <div className="coverage-grid">
          <div><span>Repository files</span><strong>{audit.coverage.repositoryFiles}</strong></div>
          <div><span>Supported files</span><strong>{audit.coverage.supportedFiles}</strong></div>
          <div><span>Fetched files</span><strong>{audit.coverage.fetchedFiles}</strong></div>
          <div><span>Parsed source</span><strong>{audit.coverage.analyzedSourceFiles}</strong></div>
        </div>
        {audit.coverage.skippedFiles.length > 0 ? (
          <div className="coverage-skipped">
            <strong>Skipped files</strong>
            <ul>
              {audit.coverage.skippedFiles.map((file) => (
                <li key={`${file.reason}:${file.path}`}><code>{file.path}</code><span>{file.reason} · {Math.round(file.size / 1024)} KB</span></li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="coverage-limitations">
          <strong>What this audit cannot prove</strong>
          <ul>{audit.coverage.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </details>

      {audit.strengths.length > 0 ? (
        <div className="verified-strengths">
          <strong>Verified strengths</strong>
          <ul>{audit.strengths.slice(0, 6).map((item) => <li key={item.id}><span>✓</span><div><b>{item.title}</b><small>{item.evidence}</small></div></li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
