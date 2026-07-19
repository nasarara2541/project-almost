"use client";

import type { AnalyzeResult, PreviewSession, PreviewSessionStatus } from "@/types/api";

/**
 * Optional enhancement: run a supported React/Next/Vite project live inside
 * a sandboxed in-browser Node.js runtime (WebContainers). This is never the
 * primary preview — the static interface gallery works for every repository
 * without executing code. Repository code only ever runs inside the
 * visitor's own browser tab, never on the server.
 */

type LivePreviewPanelProps = {
  analysis: AnalyzeResult;
  session: PreviewSession | null;
  previewLogs: string[];
  isStarting: boolean;
  onStartPreview: (projectRoot: string) => void;
  onStopPreview: () => void;
};

const statusCopy: Record<PreviewSessionStatus, string> = {
  queued: "Fetching repository files…",
  analyzing: "Booting the in-browser Node.js runtime…",
  starting: "Running npm install and the dev server in your browser…",
  ready: "Live preview running",
  failed: "Live preview failed",
  expired: "Live preview stopped",
};

export function LivePreviewPanel({
  analysis,
  session,
  previewLogs,
  isStarting,
  onStartPreview,
  onStopPreview,
}: LivePreviewPanelProps) {
  const candidates = analysis.project.previewCandidates.filter((candidate) => candidate.available);

  return (
    <section className="live-preview" aria-labelledby="live-preview-heading">
      <div className="live-preview__heading">
        <span className="step-number">05</span>
        <div>
          <p className="section-label">Optional enhancement</p>
          <h2 id="live-preview-heading">Live execution preview</h2>
          <p>
            The gallery above is static and safe for any repository. For runnable React, Next.js,
            and Vite projects you can additionally boot the real app in a sandboxed WebContainer
            inside your own browser tab — no repository code runs on the server.
          </p>
        </div>
        {session ? (
          <button type="button" className="reset-button" onClick={onStopPreview}>
            Stop preview
          </button>
        ) : null}
      </div>

      {candidates.length === 0 ? (
        <p className="live-preview__unavailable">{analysis.project.previewReason}</p>
      ) : session?.status === "ready" && session.previewUrl ? (
        <iframe
          className="preview-frame"
          src={session.previewUrl}
          title="Live in-browser repository preview"
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
          allow="cross-origin-isolated"
        />
      ) : (
        <div className="live-preview__controls">
          {candidates.map((candidate) => (
            <button
              key={candidate.root}
              type="button"
              disabled={isStarting}
              onClick={() => onStartPreview(candidate.root)}
            >
              {isStarting
                ? statusCopy[session?.status ?? "queued"]
                : `Run ${candidate.root === "." ? analysis.name : candidate.root} live (${candidate.framework})`}
            </button>
          ))}
          {session?.status === "failed" ? (
            <p className="live-preview__error" role="alert">{session.error ?? statusCopy.failed}</p>
          ) : null}
          {previewLogs.length > 0 && session && ["starting", "failed"].includes(session.status) ? (
            <pre className="preview-log" aria-label="Preview runtime log">
              {previewLogs.slice(-12).join("\n")}
            </pre>
          ) : null}
        </div>
      )}
    </section>
  );
}
