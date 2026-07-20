"use client";

import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import type { AnalyzeResult } from "@/types/api";

export function ContributionOpportunities({ analysis }: { analysis: AnalyzeResult }) {
  const opportunities = analysis.audit.opportunities;
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<string | null>(null);
  return (
    <section className="contribution-opportunities" aria-labelledby="opportunities-heading">
      <div className="results-section-heading">
        <span className="step-number">03</span>
        <div>
          <p className="section-label">Ready-to-use tasks</p>
          <h2 id="opportunities-heading">Tasks you can contribute</h2>
          <p>Choose a useful task, copy it, and open an issue or pull request with the evidence already attached.</p>
        </div>
      </div>

      {opportunities.length > 0 ? (
        <div className="opportunity-grid">
          {opportunities.map((opportunity, index) => {
            const isExpanded = expandedOpportunityId === opportunity.id;
            const detailsId = `opportunity-details-${opportunity.id.replace(/[^a-z0-9_-]+/gi, "-")}`;
            return (
              <article key={opportunity.id} className={`opportunity-card ${isExpanded ? "is-expanded" : ""}`}>
                <div className="opportunity-card__row">
                  <span className="opportunity-card__index">{String(index + 1).padStart(2, "0")}</span>
                  <div className="opportunity-card__content">
                    <div className="opportunity-card__meta">
                      <span className={`severity-pill severity-pill--${opportunity.impact}`}>{opportunity.impact} impact</span>
                      <span>{opportunity.difficulty.replace("-", " ")}</span>
                      <span>{opportunity.files.length > 0 ? `${opportunity.files.length} related file${opportunity.files.length === 1 ? "" : "s"}` : "Repository-wide"}</span>
                    </div>
                    <h3>{opportunity.title}</h3>
                    <p>{opportunity.summary}</p>
                  </div>
                  <div className="opportunity-card__actions">
                    <button
                      type="button"
                      className="opportunity-card__toggle"
                      aria-expanded={isExpanded}
                      aria-controls={detailsId}
                      onClick={() => setExpandedOpportunityId(isExpanded ? null : opportunity.id)}
                    >
                      {isExpanded ? "Close" : "View task"}
                    </button>
                    <CopyButton value={opportunity.task} label="Opportunity" />
                  </div>
                </div>
                {isExpanded ? (
                  <div className="opportunity-task" id={detailsId}>
                    <div><strong>Suggested task</strong><p>{opportunity.task}</p></div>
                    <CopyButton value={opportunity.task} label="Opportunity" />
                  </div>
                ) : null}
              </article>
            );
          })}
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
