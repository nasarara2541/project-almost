"use client";

import type { SavedAnalysisSummary } from "@/types/api";

type SavedAnalysesProps = {
  analyses: SavedAnalysisSummary[];
  isLoading: boolean;
  rescanningId: string | null;
  onOpen: (id: string) => void;
  onRescan: (id: string) => void;
};

export function SavedAnalyses({
  analyses,
  isLoading,
  rescanningId,
  onOpen,
  onRescan,
}: SavedAnalysesProps) {
  return (
    <section className="saved-analyses" aria-labelledby="saved-analyses-heading">
      <div className="saved-analyses__heading">
        <div>
          <p className="section-label">Your workspace</p>
          <h2 id="saved-analyses-heading">Saved analyses</h2>
          <p>Return to previous evidence or rescan a repository to see what changed.</p>
        </div>
        <span>{analyses.length} saved</span>
      </div>

      {isLoading ? (
        <p className="saved-analyses__empty">Loading your repository history…</p>
      ) : analyses.length > 0 ? (
        <div className="saved-analysis-list">
          {analyses.slice(0, 8).map((analysis) => (
            <article key={analysis.id} className="saved-analysis-card">
              <div className="saved-analysis-card__repo">
                <span>{analysis.isPrivate ? "Private" : "Public"}</span>
                <strong>{analysis.name}</strong>
                <small>{analysis.repoUrl}</small>
              </div>
              <dl>
                <div><dt>Matches</dt><dd>{analysis.opportunityCount}</dd></div>
                <div><dt>Findings</dt><dd>{analysis.findingCount}</dd></div>
                <div><dt>Coverage</dt><dd>{analysis.coveragePercent}%</dd></div>
              </dl>
              <time dateTime={analysis.createdAt}>{analysis.createdAt.slice(0, 10)}</time>
              <div className="saved-analysis-card__actions">
                <button type="button" onClick={() => onOpen(analysis.id)}>Open</button>
                <button type="button" onClick={() => onRescan(analysis.id)} disabled={rescanningId === analysis.id}>
                  {rescanningId === analysis.id ? "Rescanning…" : "Rescan"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="saved-analyses__empty">Your next signed-in analysis will appear here automatically.</p>
      )}
    </section>
  );
}
