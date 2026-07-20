"use client";

import { useEffect, useState } from "react";
import { AuditFindings } from "@/components/audit-findings";
import { AuditOverview } from "@/components/audit-overview";
import { ArchitecturePanel } from "@/components/architecture-panel";
import { ContributionOpportunities } from "@/components/contribution-opportunities";
import { InterfaceGallery } from "@/components/interface-gallery";
import { ProjectSummary } from "@/components/project-summary";
import { RepositoryExplorer } from "@/components/repository-explorer";
import { RepositoryForm } from "@/components/repository-form";
import { SectionNav, type SectionId } from "@/components/section-nav";
import { TracePanel } from "@/components/trace-panel";
import { BUNDLED_FIXTURE_REPO_URL } from "@/lib/preview/constants";
import { findTraceNodeId } from "@/lib/trace/highlighting";
import type {
  AnalyzeResult,
  CodeLocation,
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
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceErrorCode, setTraceErrorCode] = useState<TraceErrorCode | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("top");

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
    setTrace(null);
    setTraceError(null);
    setTraceErrorCode(null);
    setActiveSection("top");
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
      setActiveSection("start-here");
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
        body: JSON.stringify({
          analysisId: analysis.analysisId,
          repoUrl: analysis.repoUrl,
          question,
        }),
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
    resetResults();
    window.setTimeout(() => document.getElementById("repo-url")?.focus(), 0);
  }

  function handleSelectSection(section: SectionId) {
    setActiveSection(section);
    window.history.replaceState(null, "", section === "top" ? "#top" : `#${section}`);
    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  }

  const showOverview = !analysis || activeSection === "top";

  return (
    <main className={analysis ? "main--report" : undefined}>
      <a
        className="skip-link"
        href={analysis && activeSection !== "top" ? `#section-view-${activeSection}` : "#repository-heading"}
      >
        Skip to repository analysis
      </a>
      <nav className="nav" aria-label="Primary navigation">
        <a
          className="brand"
          href="#top"
          aria-label="RepoLens home"
          onClick={analysis ? (event) => { event.preventDefault(); handleSelectSection("top"); } : undefined}
        >
          <span>RL</span>RepoLens
        </a>
        <p>Turn a public repository into a clear, prioritized action plan.</p>
      </nav>

      {showOverview ? (
        <div
          id="section-view-top"
          className="report-view report-view--overview"
          role={analysis ? "tabpanel" : undefined}
          aria-labelledby={analysis ? "section-nav-top" : undefined}
        >
          <header className="hero" id="top">
            <p className="eyebrow">Open-source repository health check</p>
            <h1>Find the best thing to fix next.</h1>
            <p className="hero__copy">
              Paste a public GitHub repository and get a short, evidence-backed list of issues,
              unused files, and contribution-ready tasks. No repository code is executed.
            </p>
          </header>

          <RepositoryForm
            repoUrl={repoUrl}
            isAnalyzing={isAnalyzing}
            verifiedDemo={repoUrl.trim().toLowerCase() === BUNDLED_FIXTURE_REPO_URL}
            onRepoUrlChange={setRepoUrl}
            onSubmit={handleAnalyze}
          />

          <section className="how-it-works" aria-labelledby="how-it-works-heading">
            <div className="how-it-works__intro">
              <p className="section-label">How it works</p>
              <h2 id="how-it-works-heading">From repository to next step</h2>
            </div>
            <ol>
              <li><span>1</span><div><strong>Scan the source</strong><p>Read the files, setup, tests, and documentation safely.</p></div></li>
              <li><span>2</span><div><strong>Rank what matters</strong><p>Separate high-value problems from low-confidence guesses.</p></div></li>
              <li><span>3</span><div><strong>Pick a task</strong><p>Get the exact files, evidence, and a useful next action.</p></div></li>
            </ol>
          </section>
        </div>
      ) : null}

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
          <SectionNav activeId={activeSection} onSelect={handleSelectSection} />

          <div className="results-toolbar">
            <span className="workspace__address">{analysis.repoUrl}</span>
            <button className="reset-button" type="button" onClick={handleReset}>
              Reset analysis
            </button>
          </div>

          {activeSection === "start-here" ? (
            <section id="section-view-start-here" className="report-view" role="tabpanel" aria-labelledby="section-nav-start-here">
              <AuditOverview analysis={analysis} onViewGaps={() => handleSelectSection("gaps")} />
            </section>
          ) : null}

          {activeSection === "gaps" ? (
            <section id="section-view-gaps" className="report-view" role="tabpanel" aria-labelledby="section-nav-gaps">
              <AuditFindings analysis={analysis} />
            </section>
          ) : null}

          {activeSection === "opportunities" ? (
            <section id="section-view-opportunities" className="report-view" role="tabpanel" aria-labelledby="section-nav-opportunities">
              <ContributionOpportunities analysis={analysis} />
            </section>
          ) : null}

          {activeSection === "repository-explorer" ? (
            <section id="section-view-repository-explorer" className="report-view" role="tabpanel" aria-labelledby="section-nav-repository-explorer">
              <RepositoryExplorer analysis={analysis} />
              <ProjectSummary analysis={analysis} />
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
            </section>
          ) : null}

          {activeSection === "interface" ? (
            <section id="section-view-interface" className="report-view" role="tabpanel" aria-labelledby="section-nav-interface">
              <InterfaceGallery
                analysis={analysis}
                selectedItemId={selectedGalleryId}
                onSelectItem={handleSelectGalleryItem}
              />
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
