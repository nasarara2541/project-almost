"use client";

import { useEffect, useState } from "react";
import { AuditFindings } from "@/components/audit-findings";
import { ArchitecturePanel } from "@/components/architecture-panel";
import { ContributionOpportunities } from "@/components/contribution-opportunities";
import { InterfaceGallery } from "@/components/interface-gallery";
import { ProjectSummary } from "@/components/project-summary";
import { RepositoryExplorer } from "@/components/repository-explorer";
import { RepositoryForm } from "@/components/repository-form";
import { SavedAnalyses } from "@/components/saved-analyses";
import { SectionNav, type SectionId } from "@/components/section-nav";
import { TracePanel } from "@/components/trace-panel";
import { BUNDLED_FIXTURE_REPO_URL } from "@/lib/preview/constants";
import { findTraceNodeId } from "@/lib/trace/highlighting";
import type {
  AnalyzeResult,
  AnalysisComparison,
  CodeLocation,
  ContributionFeedbackRecord,
  ContributorProfile,
  GithubRepositoryOption,
  SavedAnalysisSummary,
  SessionUser,
  TraceErrorCode,
  TraceResult,
} from "@/types/api";

export default function Home() {
  const [repoUrl, setRepoUrl] = useState(BUNDLED_FIXTURE_REPO_URL);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [analysisLive, setAnalysisLive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedGalleryId, setSelectedGalleryId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceErrorCode, setTraceErrorCode] = useState<TraceErrorCode | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("top");
  const [contributorProfile, setContributorProfile] = useState<ContributorProfile>({
    experience: "new",
    time: "two-hours",
    focus: "any",
  });
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [authConfigured, setAuthConfigured] = useState(true);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [githubRepositories, setGithubRepositories] = useState<GithubRepositoryOption[]>([]);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysisSummary[]>([]);
  const [savedAnalysesLoading, setSavedAnalysesLoading] = useState(false);
  const [rescanningId, setRescanningId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<AnalysisComparison | null>(null);
  const [initialFeedback, setInitialFeedback] = useState<ContributionFeedbackRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadAccount() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const body = await response.json() as { configured?: boolean; user?: SessionUser | null };
        if (cancelled) return;
        setAuthConfigured(Boolean(body.configured));
        setSessionUser(body.user ?? null);
        if (body.user) {
          setSavedAnalysesLoading(true);
          const [repositoriesResponse, analysesResponse] = await Promise.all([
            fetch("/api/github/repositories", { cache: "no-store" }),
            fetch("/api/saved-analyses", { cache: "no-store" }),
          ]);
          const repositoriesBody = await repositoriesResponse.json() as { repositories?: GithubRepositoryOption[] };
          const analysesBody = await analysesResponse.json() as { analyses?: SavedAnalysisSummary[] };
          if (!cancelled) {
            setGithubRepositories(repositoriesBody.repositories ?? []);
            setSavedAnalyses(analysesBody.analyses ?? []);
          }
        }
      } catch {
        if (!cancelled) setAccountError("Account features could not be loaded.");
      } finally {
        if (!cancelled) {
          setAccountLoading(false);
          setSavedAnalysesLoading(false);
        }
      }
    }
    const authError = new URLSearchParams(window.location.search).get("auth_error");
    if (authError) setAccountError(authError);
    void loadAccount();
    return () => { cancelled = true; };
  }, []);

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
    setAnalysisLive(false);
    setAnalysisError(null);
    setSelectedGalleryId(null);
    setSelectedNodeId(null);
    setTrace(null);
    setTraceError(null);
    setTraceErrorCode(null);
    setActiveSection("top");
    setComparison(null);
    setInitialFeedback([]);
  }

  function presentAnalysis(result: AnalyzeResult, live = true) {
    setActiveSection("opportunities");
    setAnalysis(result);
    setAnalysisLive(live);
    setTrace(null);
    setTraceErrorCode(null);
    setTraceError(live ? null : "This is a saved snapshot. Rescan it to restore source-backed feature tracing.");
    const firstScreen = result.interface.screens.find((screen) => screen.previewHtml);
    if (firstScreen) {
      setSelectedGalleryId(firstScreen.id);
      setSelectedNodeId(findTraceNodeId(result.graph, firstScreen.location));
    } else {
      const firstRoute = result.graph.nodes.find((node) => node.type === "route");
      setSelectedNodeId(firstRoute?.id ?? result.graph.nodes[0]?.id ?? null);
    }
  }

  async function refreshSavedAnalyses() {
    if (!sessionUser) return;
    const response = await fetch("/api/saved-analyses", { cache: "no-store" });
    const body = await response.json() as { analyses?: SavedAnalysisSummary[] };
    if (response.ok) setSavedAnalyses(body.analyses ?? []);
  }

  async function handleAnalyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAnalyzing(true);
    resetResults();
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, profile: contributorProfile }),
      });
      const body = (await response.json()) as AnalyzeResult | { error?: string };
      if (!response.ok || !("graph" in body)) {
        throw new Error("error" in body ? body.error : "Repository analysis failed.");
      }
      presentAnalysis(body);
      setInitialFeedback([]);
      if (sessionUser) await refreshSavedAnalyses();
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Repository analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleOpenSaved(id: string) {
    setAnalysisError(null);
    const response = await fetch(`/api/saved-analyses/${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await response.json() as {
      analysis?: AnalyzeResult;
      profile?: ContributorProfile;
      feedback?: ContributionFeedbackRecord[];
      error?: string;
    };
    if (!response.ok || !body.analysis || !body.profile) {
      setAnalysisError(body.error ?? "Saved analysis could not be opened.");
      return;
    }
    setContributorProfile(body.profile);
    setInitialFeedback(body.feedback ?? []);
    setComparison(null);
    presentAnalysis(body.analysis, false);
  }

  async function handleRescan(id: string) {
    setRescanningId(id);
    setAnalysisError(null);
    try {
      const response = await fetch(`/api/saved-analyses/${encodeURIComponent(id)}/rescan`, { method: "POST" });
      const body = await response.json() as {
        analysis?: AnalyzeResult;
        profile?: ContributorProfile;
        comparison?: AnalysisComparison;
        error?: string;
      };
      if (!response.ok || !body.analysis || !body.profile || !body.comparison) {
        throw new Error(body.error ?? "Repository rescan failed.");
      }
      setContributorProfile(body.profile);
      setInitialFeedback([]);
      setComparison(body.comparison);
      presentAnalysis(body.analysis);
      await refreshSavedAnalyses();
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Repository rescan failed.");
    } finally {
      setRescanningId(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionUser(null);
    setSavedAnalyses([]);
    setGithubRepositories([]);
    resetResults();
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
    window.history.replaceState(null, "", "#top");
    window.setTimeout(() => document.getElementById("repo-url")?.focus(), 0);
  }

  function handleAnalyzeRealRepository() {
    setRepoUrl("");
    handleReset();
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
        <div className="nav__actions">
          <p>Find a contribution you can confidently start.</p>
          {accountLoading ? <span className="account-status">Loading account…</span>
            : sessionUser ? (
              <div className="account-menu">
                {sessionUser.avatarUrl ? <img src={sessionUser.avatarUrl} alt="" /> : null}
                <span>@{sessionUser.login}</span>
                <button type="button" onClick={handleLogout}>Sign out</button>
              </div>
            ) : authConfigured ? (
              <a className="github-connect" href="/api/auth/github">Connect GitHub</a>
            ) : <span className="account-status">GitHub setup needed</span>}
        </div>
      </nav>

      {showOverview ? (
        <div
          id="section-view-top"
          className="report-view report-view--overview"
          role={analysis ? "tabpanel" : undefined}
          aria-labelledby={analysis ? "section-nav-top" : undefined}
        >
          <header className="hero" id="top">
            <p className="eyebrow">Contribution finder for open source</p>
            <h1>Find work worth contributing.</h1>
            <p className="hero__copy">
              Tell us what you know and how much time you have. RepoLens will inspect a public
              repository and match you with three evidence-backed tasks you can actually start.
              Connect GitHub to save reports and include private repositories you install RepoLens on.
            </p>
          </header>

          <RepositoryForm
            repoUrl={repoUrl}
            isAnalyzing={isAnalyzing}
            verifiedDemo={repoUrl.trim().toLowerCase() === BUNDLED_FIXTURE_REPO_URL}
            profile={contributorProfile}
            signedIn={Boolean(sessionUser)}
            authConfigured={authConfigured}
            repositories={githubRepositories}
            onRepoUrlChange={setRepoUrl}
            onProfileChange={setContributorProfile}
            onSubmit={handleAnalyze}
          />

          <section className="how-it-works" aria-labelledby="how-it-works-heading">
            <div className="how-it-works__intro">
              <p className="section-label">What you get</p>
              <h2 id="how-it-works-heading">A useful task, not another score</h2>
            </div>
            <ol>
              <li><span>1</span><div><strong>Match your time</strong><p>Quick wins stay quick; larger work is shown only when it fits.</p></div></li>
              <li><span>2</span><div><strong>Verify the evidence</strong><p>See exact files, confidence, and the limits of every finding.</p></div></li>
              <li><span>3</span><div><strong>Start contributing</strong><p>Copy the task or open a prefilled GitHub issue in one click.</p></div></li>
            </ol>
          </section>

          {accountError ? <p className="account-error" role="alert">{accountError}</p> : null}
          {sessionUser ? (
            <SavedAnalyses
              analyses={savedAnalyses}
              isLoading={savedAnalysesLoading}
              rescanningId={rescanningId}
              onOpen={handleOpenSaved}
              onRescan={handleRescan}
            />
          ) : null}
        </div>
      ) : null}

      {isAnalyzing ? (
        <section className="analysis-state" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <h2>Analyzing repository</h2>
          <p>Checking repository gaps and matching them to your contribution profile…</p>
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
            <div>
              <span className="results-toolbar__label">Current repository</span>
              <span className="workspace__address">{analysis.repoUrl}</span>
            </div>
            <button className="reset-button" type="button" onClick={handleReset}>
              New analysis
            </button>
          </div>

          {comparison ? (
            <section className="rescan-summary" aria-label="Changes since the previous analysis">
              <strong>Repository rescanned</strong>
              <span>{comparison.resolved.length} resolved</span>
              <span>{comparison.added.length} new</span>
              <span>{comparison.unchangedCount} unchanged</span>
            </section>
          ) : null}

          {activeSection === "gaps" ? (
            <section id="section-view-gaps" className="report-view" role="tabpanel" aria-labelledby="section-nav-gaps">
              <AuditFindings analysis={analysis} />
            </section>
          ) : null}

          {activeSection === "opportunities" ? (
            <section id="section-view-opportunities" className="report-view" role="tabpanel" aria-labelledby="section-nav-opportunities">
              <ContributionOpportunities
                key={analysis.analysisId}
                analysis={analysis}
                profile={contributorProfile}
                signedIn={Boolean(sessionUser)}
                initialFeedback={initialFeedback}
                onAnalyzeRealRepository={handleAnalyzeRealRepository}
              />
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
                  disabled={!analysis || !analysisLive}
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
