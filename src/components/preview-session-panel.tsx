import { ArchitecturePanel } from "@/components/architecture-panel";
import { TracePanel } from "@/components/trace-panel";
import type {
  AnalyzeResult,
  CodeLocation,
  PreviewSession,
  PreviewSessionStatus,
  TraceErrorCode,
  TraceResult,
} from "@/types/api";

type PreviewSessionPanelProps = {
  session: PreviewSession | null;
  previewLogs: string[];
  isSubmitting: boolean;
  analysis: AnalyzeResult | null;
  isAnalyzing: boolean;
  analysisError: string | null;
  selectedNodeId: string | null;
  trace: TraceResult | null;
  isTracing: boolean;
  traceError: string | null;
  traceErrorCode: TraceErrorCode | null;
  onAskTrace: (question: string) => Promise<void>;
  onSelectTraceLocation: (location: CodeLocation) => void;
  onSelectNode: (nodeId: string) => void;
  onReset: () => void;
};

const statusCopy: Record<PreviewSessionStatus, { label: string; detail: string }> = {
  queued: { label: "Fetching source", detail: "Downloading the repository files for the in-browser runtime." },
  analyzing: { label: "Booting runtime", detail: "Starting the sandboxed Node.js runtime in your browser tab." },
  starting: { label: "Installing & starting", detail: "Running npm install and the dev server inside the WebContainer." },
  ready: { label: "Ready", detail: "The live preview is running in your browser." },
  failed: { label: "Failed", detail: "The in-browser preview could not start." },
  expired: { label: "Ended", detail: "The preview was stopped." },
};

export function PreviewSessionPanel({
  session,
  previewLogs,
  isSubmitting,
  analysis,
  isAnalyzing,
  analysisError,
  selectedNodeId,
  trace,
  isTracing,
  traceError,
  traceErrorCode,
  onAskTrace,
  onSelectTraceLocation,
  onSelectNode,
  onReset,
}: PreviewSessionPanelProps) {
  const currentStatus = isSubmitting ? session?.status ?? "queued" : session?.status;
  const currentCopy = currentStatus ? statusCopy[currentStatus] : null;
  const stateHeading = analysisError
    ? "Analysis failed"
    : isAnalyzing
      ? "Analyzing repository"
      : session?.status === "expired"
      ? "Preview expired"
      : session?.status === "failed"
        ? "Preview unavailable"
        : analysis
          ? analysis.project.previewAvailable
            ? "Analysis ready; preview not started"
            : "Analysis available; live preview unavailable"
          : currentCopy?.label ?? "Analyze a repository to map its architecture";

  return (
    <section className="workspace" aria-live="polite" aria-busy={isSubmitting}>
      <div className="workspace__topbar">
        <div className="window-controls" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="workspace__address">
          {session?.previewUrl ?? analysis?.repoUrl ?? "Repository analysis will appear here"}
        </span>
        <span className={`status-badge status-badge--${currentStatus ?? "idle"}`}>
          {currentCopy?.label ?? "No session"}
        </span>
        {session || analysis || analysisError ? (
          <button className="reset-button" type="button" onClick={onReset} aria-label="Reset analysis and preview">
            Reset analysis
          </button>
        ) : null}
      </div>

      <div className={`workspace__body ${analysis ? "workspace__body--ready" : ""}`}>
        {session?.status === "ready" && session.previewUrl ? (
          <section className="preview-panel" aria-labelledby="preview-heading">
            <div className="panel-titlebar">
              <span className="step-number">02</span>
              <div>
                <small>Live product</small>
                <h2 id="preview-heading">In-browser preview</h2>
              </div>
              <span className="success-indicator"><i />Running</span>
            </div>
            <iframe
              className="preview-frame"
              src={session.previewUrl}
              title="In-browser repository preview"
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
              referrerPolicy="no-referrer"
              allow="cross-origin-isolated"
            />
          </section>
        ) : (
          <div className="preview-empty">
            {isAnalyzing || isSubmitting || ["queued", "analyzing", "starting"].includes(session?.status ?? "") ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <span className="lens-mark">↗</span>
            )}
            <h2>{stateHeading}</h2>
            <p>
              {analysisError ??
                session?.error ??
                (analysis
                  ? analysis.project.previewAvailable
                    ? "Choose Start Live Preview for a detected verified subproject, or continue exploring the architecture without execution."
                    : analysis.project.previewReason
                  : null) ??
                  currentCopy?.detail ??
                  "Enter any public GitHub repository. Analysis never executes repository code."}
            </p>
            {previewLogs.length > 0 && session && ["starting", "failed"].includes(session.status) ? (
              <pre className="preview-log" aria-label="Preview runtime log">
                {previewLogs.slice(-12).join("\n")}
              </pre>
            ) : null}
          </div>
        )}

        {analysis || isAnalyzing || analysisError ? (
          <div className="code-insight-workspace">
            <ArchitecturePanel
              analysis={analysis}
              isLoading={isAnalyzing}
              error={analysisError}
              selectedNodeId={selectedNodeId}
              trace={trace}
              onSelectNode={onSelectNode}
            />
            <TracePanel
              disabled={!analysis || Boolean(analysisError)}
              isLoading={isTracing}
              error={traceError}
              errorCode={traceErrorCode}
              trace={trace}
              onAsk={onAskTrace}
              onSelectLocation={onSelectTraceLocation}
            />
          </div>
        ) : (
        <aside className="session-panel" aria-label="Preview session status">
          <div>
            <p className="section-label">Preview session</p>
            <h3>{session ? "Session requested" : "Waiting for a repository"}</h3>
          </div>
          <ol className="status-list">
            {(["queued", "analyzing", "starting", "ready", "failed", "expired"] as const).map((status, index) => {
              const isActive = currentStatus === status;
              return (
                <li key={status} className={isActive ? "is-active" : undefined}>
                  <span>{index < 4 ? index + 1 : "!"}</span>
                  <div>
                    <strong>{statusCopy[status].label}</strong>
                    <small>{statusCopy[status].detail}</small>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="safety-note">
            <strong>Sandboxed by design</strong>
            <span>Repository code runs only inside a WebContainer in your own browser tab, never on the server.</span>
          </div>
        </aside>
        )}
      </div>
    </section>
  );
}
