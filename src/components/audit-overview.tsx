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

type AuditOverviewProps = {
  analysis: AnalyzeResult;
  onViewGaps: () => void;
};

export function AuditOverview({ analysis, onViewGaps }: AuditOverviewProps) {
  const { audit } = analysis;
  const highPriority = audit.findings.filter((finding) => finding.severity === "high").length;
  const actionable = audit.findings.filter((finding) => finding.severity !== "info");
  const firstPriority = actionable.find((finding) => finding.severity === "high") ?? actionable[0];

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
          <p className="section-label">Your repository summary</p>
          <h2 id="audit-overview-heading">
            {highPriority > 0 ? `${highPriority} issue${highPriority === 1 ? "" : "s"} to fix first` : "Your clearest next steps"}
          </h2>
          <p>RepoLens found {actionable.length} actionable issue{actionable.length === 1 ? "" : "s"} and {audit.opportunities.length} contribution-ready task{audit.opportunities.length === 1 ? "" : "s"}.</p>
        </div>
        <button type="button" className="report-download" onClick={downloadReport}>
          Download report
        </button>
      </div>

      {firstPriority ? (
        <div className="audit-next-action">
          <div>
            <span>Recommended first step</span>
            <strong>{firstPriority.title}</strong>
            <p>{firstPriority.summary}</p>
          </div>
          <button type="button" onClick={onViewGaps}>Review top issues <span aria-hidden="true">→</span></button>
        </div>
      ) : null}

      <div className="audit-scorecard">
        <div className={`audit-score audit-score--${audit.status}`}>
          <span>{audit.score}</span>
          <small>/100</small>
          <strong>{statusLabels[audit.status]}</strong>
          <p>Transparent readiness score based on the findings shown below.</p>
        </div>
        <div className="audit-key-metrics">
          <div><strong>{highPriority}</strong><span>Fix first</span></div>
          <div><strong>{actionable.length}</strong><span>Total issues</span></div>
          <div><strong>{audit.opportunities.length}</strong><span>Ready-to-use tasks</span></div>
          <div><strong>{audit.coverage.coveragePercent}%</strong><span>Files checked</span></div>
        </div>
      </div>

      <details className="coverage-disclosure score-breakdown">
        <summary><span>See the full score and coverage breakdown</span><strong>{audit.score}/100</strong></summary>
        <div className="category-score-grid">
          {audit.categoryScores.map((category) => (
            <div key={category.category} className="category-score">
              <div><strong>{categoryLabels[category.category]}</strong><span>{category.findingCount} finding{category.findingCount === 1 ? "" : "s"}</span></div>
              <div className="category-score__track" aria-label={`${categoryLabels[category.category]} score ${category.score} out of 100`}><span style={{ width: `${category.score}%` }} /></div>
              <b>{category.score}</b>
            </div>
          ))}
        </div>
        <div className="coverage-grid">
          <div><span>Repository files</span><strong>{audit.coverage.repositoryFiles}</strong></div>
          <div><span>Supported files</span><strong>{audit.coverage.supportedFiles}</strong></div>
          <div><span>Fetched files</span><strong>{audit.coverage.fetchedFiles}</strong></div>
          <div><span>Parsed source</span><strong>{audit.coverage.analyzedSourceFiles}</strong></div>
        </div>
        <div className="coverage-limitations"><strong>Important limits</strong><ul>{audit.coverage.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>
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
