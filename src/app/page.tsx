"use client";

import { useEffect, useState } from "react";
import { ArchitecturePanel } from "@/components/architecture-panel";
import { InterfaceGallery } from "@/components/interface-gallery";
import { LivePreviewPanel } from "@/components/live-preview-panel";
import { ProjectSummary } from "@/components/project-summary";
import { RepositoryForm } from "@/components/repository-form";
import { TracePanel } from "@/components/trace-panel";
import { BUNDLED_FIXTURE_REPO_URL } from "@/lib/preview/constants";
import { findTraceNodeId } from "@/lib/trace/highlighting";
import type {
  AnalyzeResult,
  CodeLocation,
  PreviewBundle,
  PreviewSession,
  TraceErrorCode,
  TraceResult,
} from "@/types/api";

export default function Home() {
  const [repoUrl, setRepoUrl] = useState(BUNDLED_FIXTURE_REPO_URL);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedGalleryId, setSelectedGalleryId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [isStartingPreview, setIsStartingPreview] = useState(false);
  const [previewLogs, setPreviewLogs] = useState<string[]>([]);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceErrorCode, setTraceErrorCode] = useState<TraceErrorCode | null>(null);

  useEffect(() => {
    if (session && ["ready", "failed"].includes(session.status)) {
      setIsStartingPreview(false);
    }
  }, [session?.status]);

  useEffect(() => {
    const analysisId = analysis?.analysisId;
    if (!analysisId) return;
    return () => {
      void fetch(`/api/analyze/${encodeURIComponent(analysisId)}`, {
        method: "DELETE",
        keepalive: true,
      });
    };
  }, [analysis?.analysisId]);

  function resetResults() {
    setAnalysis(null);
    setAnalysisError(null);
    setSelectedGalleryId(null);
    setSelectedNodeId(null);
    setSession(null);
    setPreviewLogs([]);
    setTrace(null);
    setTraceError(null);
    setTraceErrorCode(null);
  }

  async function handleAnalyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAnalyzing(true);
    resetResults();
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });
      const body = (await response.json()) as AnalyzeResult | { error?: string };
      if (!response.ok || !("graph" in body)) {
        throw new Error("error" in body ? body.error : "Repository analysis failed.");
      }
      setAnalysis(body);
      const firstScreen = body.interface.screens.find((screen) => screen.previewHtml);
      if (firstScreen) {
        setSelectedGalleryId(firstScreen.id);
        setSelectedNodeId(findTraceNodeId(body.graph, firstScreen.location));
      } else {
        const firstRoute = body.graph.nodes.find((node) => node.type === "route");
        setSelectedNodeId(firstRoute?.id ?? body.graph.nodes[0]?.id ?? null);
      }
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Repository analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleSelectGalleryItem(itemId: string, graphNodeId: string | null) {
    if (!analysis) return;
    setSelectedGalleryId(itemId);
    if (graphNodeId && analysis.graph.nodes.some((node) => node.id === graphNodeId)) {
      setSelectedNodeId(graphNodeId);
      return;
    }
    const item =
      analysis.interface.screens.find((screen) => screen.id === itemId) ??
      analysis.interface.components.find(
        (component) => `component-card:${component.file}#${component.name}` === itemId,
      );
    if (item) setSelectedNodeId(findTraceNodeId(analysis.graph, item.location));
  }

  async function handleStartPreview(projectRoot: string) {
    if (!analysis) return;
    const repoUrl = analysis.repoUrl;
    setSession({ id: "browser", repoUrl, status: "queued" });
    setPreviewLogs([]);
    setIsStartingPreview(true);
    try {
      const response = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: analysis.analysisId, projectRoot, repoUrl }),
      });
      const body = (await response.json()) as PreviewBundle | { error?: string };
      if (!response.ok || !("files" in body)) {
        throw new Error("error" in body ? body.error : "Preview bundle could not be created.");
      }

      const { runPreviewBundle } = await import("@/lib/preview/webcontainer-client");
      const statusMap = {
        booting: "analyzing",
        installing: "starting",
        starting: "starting",
        ready: "ready",
      } as const;
      await runPreviewBundle(body, {
        onStatus: (status) => {
          setSession((current) =>
            current ? { ...current, status: statusMap[status], framework: body.framework } : current,
          );
        },
        onLog: (line) => {
          setPreviewLogs((current) => [...current.slice(-199), line]);
        },
        onServerReady: (url) => {
          setSession((current) =>
            current ? { ...current, status: "ready", previewUrl: url } : current,
          );
        },
        onError: (message) => {
          setSession((current) =>
            current && current.status !== "ready"
              ? { ...current, status: "failed", error: message }
              : current,
          );
        },
      });
    } catch (error) {
      setSession({
        id: "browser",
        repoUrl,
        status: "failed",
        error: error instanceof Error ? error.message : "The in-browser preview could not start.",
      });
      setIsStartingPreview(false);
    }
  }

  function handleStopPreview() {
    void import("@/lib/preview/webcontainer-client").then(({ stopPreview }) => stopPreview());
    setSession(null);
    setPreviewLogs([]);
    setIsStartingPreview(false);
  }

  async function handleTrace(question: string) {
    if (!analysis) return;
    setIsTracing(true);
    setTrace(null);
    setTraceError(null);
    setTraceErrorCode(null);
    try {
      const response = await fetch("/api/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: analysis.analysisId, question }),
      });
      const body = (await response.json()) as
        | TraceResult
        | { error?: string; code?: TraceErrorCode };
      if (!response.ok || !("steps" in body)) {
        if ("code" in body && body.code) setTraceErrorCode(body.code);
        throw new Error("error" in body ? body.error : "Feature tracing failed.");
      }
      setTrace(body);
      const firstLocation = body.steps[0]?.location;
      if (firstLocation) setSelectedNodeId(findTraceNodeId(analysis.graph, firstLocation));
    } catch (error) {
      setTraceError(error instanceof Error ? error.message : "Feature tracing failed.");
    } finally {
      setIsTracing(false);
    }
  }

  function handleTraceLocation(location: CodeLocation) {
    if (!analysis) return;
    const nodeId = findTraceNodeId(analysis.graph, location);
    if (nodeId) setSelectedNodeId(nodeId);
  }

  function handleReset() {
    void import("@/lib/preview/webcontainer-client").then(({ stopPreview }) => stopPreview());
    resetResults();
    setIsStartingPreview(false);
    window.setTimeout(() => document.getElementById("repo-url")?.focus(), 0);
  }

  return (
    <main>
      <a className="skip-link" href="#repository-heading">Skip to repository analysis</a>
      <nav className="nav" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="RepoLens home"><span>RL</span>RepoLens</a>
        <p>See the interface inside any public GitHub repository.</p>
      </nav>

      <header className="hero" id="top">
        <p className="eyebrow">GitHub-to-interface visualizer</p>
        <h1>What does this repo look like — and which code makes it?</h1>
        <p className="hero__copy">
          Paste a public GitHub repository. RepoLens inspects the source read-only, reconstructs a
          safe visual preview of the interface it contains, and connects every screen and component
          back to the files that create it. No repository code is executed.
        </p>
      </header>

      <section className="how-it-works" aria-labelledby="how-it-works-heading">
        <div className="how-it-works__intro">
          <p className="section-label">How it works</p>
          <h2 id="how-it-works-heading">Fetch → detect → preview → connect</h2>
        </div>
        <ol>
          <li><span>1</span><div><strong>Fetch &amp; analyze</strong><p>Read metadata, manifests, and source read-only. Detect the project type, frameworks, and monorepo packages.</p></div></li>
          <li><span>2</span><div><strong>Detect the interface</strong><p>Find pages, routes, popups, components, styles, and assets — including Chrome-extension popups.</p></div></li>
          <li><span>3</span><div><strong>Preview &amp; connect</strong><p>Explore a static interface gallery, click any screen to see its source, and trace features through the architecture graph.</p></div></li>
        </ol>
      </section>

      <RepositoryForm
        repoUrl={repoUrl}
        isAnalyzing={isAnalyzing}
        verifiedDemo={repoUrl.trim().toLowerCase() === BUNDLED_FIXTURE_REPO_URL}
        onRepoUrlChange={setRepoUrl}
        onSubmit={handleAnalyze}
      />

      {isAnalyzing ? (
        <section className="analysis-state" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <h2>Analyzing repository</h2>
          <p>Fetching source read-only and reconstructing the interface…</p>
        </section>
      ) : analysisError ? (
        <section className="analysis-state analysis-state--error" role="alert">
          <h2>Analysis failed</h2>
          <p>{analysisError}</p>
        </section>
      ) : null}

      {analysis ? (
        <>
          <div className="results-toolbar">
            <span className="workspace__address">{analysis.repoUrl}</span>
            <button className="reset-button" type="button" onClick={handleReset}>
              Reset analysis
            </button>
          </div>

          <ProjectSummary analysis={analysis} />

          <InterfaceGallery
            analysis={analysis}
            selectedItemId={selectedGalleryId}
            onSelectItem={handleSelectGalleryItem}
          />

          <div className="code-insight-workspace">
            <ArchitecturePanel
              analysis={analysis}
              isLoading={false}
              error={null}
              selectedNodeId={selectedNodeId}
              trace={trace}
              onSelectNode={setSelectedNodeId}
            />
            <TracePanel
              disabled={!analysis}
              isLoading={isTracing}
              error={traceError}
              errorCode={traceErrorCode}
              trace={trace}
              onAsk={handleTrace}
              onSelectLocation={handleTraceLocation}
            />
          </div>

          <LivePreviewPanel
            analysis={analysis}
            session={session}
            previewLogs={previewLogs}
            isStarting={isStartingPreview}
            onStartPreview={handleStartPreview}
            onStopPreview={handleStopPreview}
          />
        </>
      ) : null}
    </main>
  );
}
