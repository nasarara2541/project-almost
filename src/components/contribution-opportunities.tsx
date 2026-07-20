"use client";

import { CopyButton } from "@/components/copy-button";
import type { AnalyzeResult } from "@/types/api";

export function ContributionOpportunities({ analysis }: { analysis: AnalyzeResult }) {
  const opportunities = analysis.audit.opportunities;
  return (
    <section className="contribution-opportunities" aria-labelledby="opportunities-heading">
      <div className="results-section-heading">
        <span className="step-number">03</span>
        <div>
          <p className="section-label">Contribution finder</p>
          <h2 id="opportunities-heading">Useful work someone can pick up</h2>
          <p>These tasks are derived from verified findings, not generated from repository names or generic advice.</p>
        </div>
      </div>

      {opportunities.length > 0 ? (
        <div className="opportunity-grid">
          {opportunities.map((opportunity, index) => (
            <article key={opportunity.id} className="opportunity-card">
              <div className="opportunity-card__meta">
                <span>Opportunity {String(index + 1).padStart(2, "0")}</span>
                <span className={`severity-pill severity-pill--${opportunity.impact}`}>{opportunity.impact} impact</span>
                <span>{opportunity.difficulty.replace("-", " ")}</span>
              </div>
              <h3>{opportunity.title}</h3>
              <p>{opportunity.summary}</p>
              {opportunity.files.length > 0 ? (
                <small>{opportunity.files.length} related file{opportunity.files.length === 1 ? "" : "s"}</small>
              ) : <small>Repository-level contribution</small>}
              <div className="opportunity-task"><p>{opportunity.task}</p><CopyButton value={opportunity.task} label="Opportunity" /></div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-filter-state">
          <strong>No contribution task was generated.</strong>
          <p>The current deterministic checks did not find an evidence-backed task with sufficient confidence.</p>
        </div>
      )}
    </section>
  );
}
