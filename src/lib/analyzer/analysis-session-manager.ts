import { randomUUID } from "node:crypto";
import type { AnalyzeResult } from "../../types/api";
import { findAllowedRepository, type AllowedRepository } from "../preview/repositories";
import { fetchPublicGitHubRepository } from "./github-source";
import { detectRepositoryProject } from "./project-detector";
import { analyzeRepository, type AnalysisRepository } from "./repository-analyzer";

const DEFAULT_TTL_MS = 10 * 60 * 1_000;
const MAX_TTL_MS = 30 * 60 * 1_000;

type TimerHandle = ReturnType<typeof setTimeout>;

type AnalysisRecord = {
  result: AnalyzeResult;
  repository: AnalysisRepository;
  verifiedRepository: AllowedRepository | null;
  cleanup: () => Promise<void>;
  timer: TimerHandle;
};

function configuredTtl(): number {
  const configured = Number(process.env.ANALYSIS_TTL_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, MAX_TTL_MS)
    : DEFAULT_TTL_MS;
}

export class AnalysisSessionManager {
  private readonly records = new Map<string, AnalysisRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs = configuredTtl()) {
    this.ttlMs = ttlMs;
  }

  async create(repoUrl: string): Promise<AnalyzeResult> {
    const analysisId = randomUUID();
    const verifiedRepository = findAllowedRepository(repoUrl);
    let repository: AnalysisRepository;
    let cleanup: () => Promise<void> = async () => undefined;
    let defaultBranch: string | undefined;
    let description: string | undefined;

    if (verifiedRepository) {
      repository = {
        repoUrl: verifiedRepository.repoUrl,
        sourcePath: verifiedRepository.sourcePath,
      };
    } else {
      const fetched = await fetchPublicGitHubRepository(repoUrl);
      repository = fetched.repository;
      cleanup = fetched.cleanup;
      defaultBranch = fetched.defaultBranch;
      description = fetched.description;
    }

    try {
      // Project detection runs first so interface detection can attribute
      // screens/components to monorepo subprojects.
      const project = await detectRepositoryProject(repository, {
        verifiedLocal: Boolean(verifiedRepository),
        defaultBranch,
        description,
      });
      const result = await analyzeRepository(repository, analysisId, project);
      const timer = setTimeout(() => void this.delete(analysisId), this.ttlMs);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
      this.records.set(analysisId, {
        result,
        repository,
        verifiedRepository,
        cleanup,
        timer,
      });
      return result;
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  get(analysisId: string): AnalysisRecord | null {
    return this.records.get(analysisId) ?? null;
  }

  getResult(analysisId: string): AnalyzeResult | null {
    return this.records.get(analysisId)?.result ?? null;
  }

  async delete(analysisId: string): Promise<boolean> {
    const record = this.records.get(analysisId);
    if (!record) return false;
    this.records.delete(analysisId);
    clearTimeout(record.timer);
    await record.cleanup();
    return true;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.records.keys()].map((id) => this.delete(id)));
  }
}

declare global {
  var __repoLensAnalysisSessions: AnalysisSessionManager | undefined;
}

export const analysisSessionManager =
  globalThis.__repoLensAnalysisSessions ?? new AnalysisSessionManager();

if (process.env.NODE_ENV !== "production") {
  globalThis.__repoLensAnalysisSessions = analysisSessionManager;
}
