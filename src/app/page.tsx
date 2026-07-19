"use client";

import { useEffect, useState } from "react";
import { PreviewSessionPanel } from "@/components/preview-session-panel";
import { ProjectSummary } from "@/components/project-summary";
import { RepositoryForm } from "@/components/repository-form";
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
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [isStartingPreview, setIsStartingPreview] = useState(false);
  const [previewLogs, setPreviewLogs] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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

  async function handleAnalyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAnalyzing(true);
    setAnalysis(null);
    setAnalysisError(null);
    setSession(null);
    setSelectedNodeId(null);
    setTrace(null);
    setTraceError(null);
    setTraceErrorCode(null);
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
      const firstRoute = body.graph.nodes.find((node) => node.type === "route");
      setSelectedNodeId(firstRoute?.id ?? body.graph.nodes[0]?.id ?? null);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Repository analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
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
    setPreviewLogs([]);
    setAnalysis(null);
    setAnalysisError(null);
    setSession(null);
    setSelectedNodeId(null);
    setTrace(null);
    setTraceError(null);
    setTraceErrorCode(null);
    setIsStartingPreview(false);
    window.setTimeout(() => document.getElementById("repo-url")?.focus(), 0);
  }

  return (
    <main>
      <a className="skip-link" href="#repository-heading">Skip to repository analysis</a>
      <nav className="nav" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="RepoLens home"><span>RL</span>RepoLens</a>
        <p>Run any public React, Next.js, or Vite repo in your browser.</p>
      </nav>

      <header className="hero" id="top">
        <p className="eyebrow">Repository intelligence + optional live preview</p>
        <h1>Understand any repo. Run it live in your browser.</h1>
        <p className="hero__copy">
          Paste a public GitHub repository. RepoLens maps its architecture, then runs it live in a
          sandboxed in-browser Node.js runtime (WebContainers)—no repository code ever executes
          on the server.
        </p>
      </header>

      <section className="how-it-works" aria-labelledby="how-it-works-heading">
        <div className="how-it-works__intro">
          <p className="section-label">Two independent modes</p>
          <h2 id="how-it-works-heading">Analysis is universal. Execution is optional.</h2>
        </div>
        <ol>
          <li><span>1</span><div><strong>Fetch read-only</strong><p>Read public metadata, manifests, and supported source files.</p></div></li>
          <li><span>2</span><div><strong>Map every project</strong><p>Detect frameworks, package managers, monorepos, and runnable roots.</p></div></li>
          <li><span>3</span><div><strong>Preview in your browser</strong><p>npm install and the dev server run inside a sandboxed WebContainer in your own tab.</p></div></li>
        </ol>
      </section>

      <RepositoryForm
        repoUrl={repoUrl}
        isAnalyzing={isAnalyzing}
        verifiedDemo={repoUrl.trim().toLowerCase() === BUNDLED_FIXTURE_REPO_URL}
        onRepoUrlChange={setRepoUrl}
        onSubmit={handleAnalyze}
      />

      {analysis ? (
        <ProjectSummary
          project={analysis.project}
          isStartingPreview={isStartingPreview}
          onStartPreview={handleStartPreview}
        />
      ) : null}

      <PreviewSessionPanel
        session={session}
        previewLogs={previewLogs}
        isSubmitting={isStartingPreview}
        analysis={analysis}
        isAnalyzing={isAnalyzing}
        analysisError={analysisError}
        selectedNodeId={selectedNodeId}
        trace={trace}
        isTracing={isTracing}
        traceError={traceError}
        traceErrorCode={traceErrorCode}
        onAskTrace={handleTrace}
        onSelectTraceLocation={handleTraceLocation}
        onSelectNode={setSelectedNodeId}
        onReset={handleReset}
      />
    </main>
  );
}
