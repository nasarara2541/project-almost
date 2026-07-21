import { randomUUID } from "node:crypto";
import { database } from "@/lib/product/database";
import type {
  AnalyzeResult,
  ContributionVerification,
  ContributorProfile,
  SavedAnalysisSummary,
} from "@/types/api";

export type ProductUser = {
  id: string;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

export type StoredAuthSession = {
  tokenHash: string;
  user: ProductUser;
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
};

type SavedAnalysis = SavedAnalysisSummary & {
  result: AnalyzeResult;
  profile: ContributorProfile;
};

function text(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown) {
  return value === null || value === undefined ? null : text(value);
}

export async function upsertGithubUser(input: Omit<ProductUser, "id">): Promise<ProductUser> {
  const db = await database();
  const now = new Date().toISOString();
  const id = `github:${input.githubId}`;
  await db.execute({
    sql: `INSERT INTO users (id, github_id, login, name, avatar_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(github_id) DO UPDATE SET
        login = excluded.login,
        name = excluded.name,
        avatar_url = excluded.avatar_url,
        updated_at = excluded.updated_at`,
    args: [id, input.githubId, input.login, input.name, input.avatarUrl, now, now],
  });
  return { id, ...input };
}

export async function createAuthSession(input: {
  tokenHash: string;
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  accessExpiresAt?: string | null;
  refreshExpiresAt?: string | null;
}) {
  const db = await database();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO auth_sessions
      (token_hash, user_id, access_token, refresh_token, access_expires_at, refresh_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [input.tokenHash, input.userId, input.accessToken, input.refreshToken ?? null,
      input.accessExpiresAt ?? null, input.refreshExpiresAt ?? null, now, now],
  });
}

export async function getAuthSession(tokenHash: string): Promise<StoredAuthSession | null> {
  const db = await database();
  const result = await db.execute({
    sql: `SELECT s.token_hash, s.access_token, s.refresh_token, s.access_expires_at,
        s.refresh_expires_at, u.id, u.github_id, u.login, u.name, u.avatar_url
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    args: [tokenHash],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    tokenHash: text(row.token_hash),
    accessToken: text(row.access_token),
    refreshToken: nullableText(row.refresh_token),
    accessExpiresAt: nullableText(row.access_expires_at),
    refreshExpiresAt: nullableText(row.refresh_expires_at),
    user: {
      id: text(row.id),
      githubId: Number(row.github_id),
      login: text(row.login),
      name: nullableText(row.name),
      avatarUrl: nullableText(row.avatar_url),
    },
  };
}

export async function updateAuthSessionTokens(input: {
  tokenHash: string;
  accessToken: string;
  refreshToken?: string | null;
  accessExpiresAt?: string | null;
  refreshExpiresAt?: string | null;
}) {
  const db = await database();
  await db.execute({
    sql: `UPDATE auth_sessions SET access_token = ?, refresh_token = ?, access_expires_at = ?,
      refresh_expires_at = ?, updated_at = ? WHERE token_hash = ?`,
    args: [input.accessToken, input.refreshToken ?? null, input.accessExpiresAt ?? null,
      input.refreshExpiresAt ?? null, new Date().toISOString(), input.tokenHash],
  });
}

export async function deleteAuthSession(tokenHash: string) {
  const db = await database();
  await db.execute({ sql: "DELETE FROM auth_sessions WHERE token_hash = ?", args: [tokenHash] });
}

export async function saveAnalysis(input: {
  userId: string;
  analysis: AnalyzeResult;
  profile: ContributorProfile;
  parentId?: string | null;
}) {
  const db = await database();
  const createdAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO saved_analyses
      (id, user_id, repo_url, repo_name, is_private, result_json, profile_json, parent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET result_json = excluded.result_json, profile_json = excluded.profile_json`,
    args: [input.analysis.analysisId, input.userId, input.analysis.repoUrl, input.analysis.name,
      input.analysis.repositoryVisibility === "private" ? 1 : 0, JSON.stringify(input.analysis),
      JSON.stringify(input.profile), input.parentId ?? null, createdAt],
  });
}

function summaryFromRow(row: Record<string, unknown>, result: AnalyzeResult): SavedAnalysisSummary {
  return {
    id: text(row.id),
    repoUrl: text(row.repo_url),
    name: text(row.repo_name),
    isPrivate: Number(row.is_private) === 1,
    createdAt: text(row.created_at),
    parentId: nullableText(row.parent_id),
    findingCount: result.audit.findings.filter((finding) => finding.severity !== "info").length,
    opportunityCount: result.audit.opportunities.length,
    coveragePercent: result.audit.coverage.coveragePercent,
  };
}

export async function listSavedAnalyses(userId: string): Promise<SavedAnalysisSummary[]> {
  const db = await database();
  const result = await db.execute({
    sql: `SELECT id, repo_url, repo_name, is_private, result_json, parent_id, created_at
      FROM saved_analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    args: [userId],
  });
  return result.rows.map((row) => {
    const analysis = JSON.parse(text(row.result_json)) as AnalyzeResult;
    return summaryFromRow(row, analysis);
  });
}

export async function getSavedAnalysis(userId: string, id: string): Promise<SavedAnalysis | null> {
  const db = await database();
  const result = await db.execute({
    sql: `SELECT id, repo_url, repo_name, is_private, result_json, profile_json, parent_id, created_at
      FROM saved_analyses WHERE user_id = ? AND id = ?`,
    args: [userId, id],
  });
  const row = result.rows[0];
  if (!row) return null;
  const analysis = JSON.parse(text(row.result_json)) as AnalyzeResult;
  return {
    ...summaryFromRow(row, analysis),
    result: analysis,
    profile: JSON.parse(text(row.profile_json)) as ContributorProfile,
  };
}

export async function saveContributionFeedback(input: {
  userId: string;
  analysisId: string;
  findingId: string;
  verdict: "useful" | "started" | "completed" | "inaccurate" | "not-relevant";
  note?: string | null;
}) {
  const db = await database();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO contribution_feedback
      (id, user_id, analysis_id, finding_id, verdict, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, analysis_id, finding_id) DO UPDATE SET
        verdict = excluded.verdict, note = excluded.note, updated_at = excluded.updated_at`,
    args: [randomUUID(), input.userId, input.analysisId, input.findingId, input.verdict,
      input.note?.trim() || null, now, now],
  });
}

export async function listContributionFeedback(userId: string, analysisId: string) {
  const db = await database();
  const result = await db.execute({
    sql: `SELECT finding_id, verdict, note, updated_at FROM contribution_feedback
      WHERE user_id = ? AND analysis_id = ?`,
    args: [userId, analysisId],
  });
  return result.rows.map((row) => ({
    findingId: text(row.finding_id),
    verdict: text(row.verdict),
    note: nullableText(row.note),
    updatedAt: text(row.updated_at),
  }));
}

function verificationFromRow(row: Record<string, unknown>): ContributionVerification {
  const stored = JSON.parse(text(row.verification_json)) as ContributionVerification;
  return {
    ...stored,
    needsRefresh: Number(row.needs_refresh) === 1,
    createdAt: text(row.created_at),
    lastVerifiedAt: text(row.updated_at),
  };
}

export async function saveContributionVerification(
  userId: string,
  verification: ContributionVerification,
): Promise<ContributionVerification> {
  const db = await database();
  await db.execute({
    sql: `INSERT INTO tracked_contributions
      (id, user_id, analysis_id, finding_id, pull_request_url, owner, repo, pull_number,
        status, verification_json, needs_refresh, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(user_id, analysis_id, finding_id) DO UPDATE SET
        id = excluded.id,
        pull_request_url = excluded.pull_request_url,
        owner = excluded.owner,
        repo = excluded.repo,
        pull_number = excluded.pull_number,
        status = excluded.status,
        verification_json = excluded.verification_json,
        needs_refresh = 0,
        updated_at = excluded.updated_at`,
    args: [verification.id, userId, verification.analysisId, verification.findingId,
      verification.pullRequestUrl, verification.owner.toLowerCase(), verification.repo.toLowerCase(),
      verification.pullNumber, verification.status, JSON.stringify(verification),
      verification.createdAt, verification.lastVerifiedAt],
  });
  const saved = await getContributionVerificationForFinding(
    userId,
    verification.analysisId,
    verification.findingId,
  );
  if (!saved) throw new Error("Contribution verification was not saved.");
  return saved;
}

export async function listContributionVerifications(userId: string, analysisId: string) {
  const db = await database();
  const result = await db.execute({
    sql: `SELECT verification_json, needs_refresh, created_at, updated_at
      FROM tracked_contributions WHERE user_id = ? AND analysis_id = ? ORDER BY updated_at DESC`,
    args: [userId, analysisId],
  });
  return result.rows.map(verificationFromRow);
}

export async function getContributionVerification(userId: string, id: string) {
  const db = await database();
  const result = await db.execute({
    sql: `SELECT verification_json, needs_refresh, created_at, updated_at
      FROM tracked_contributions WHERE user_id = ? AND id = ?`,
    args: [userId, id],
  });
  return result.rows[0] ? verificationFromRow(result.rows[0]) : null;
}

export async function getContributionVerificationForFinding(
  userId: string,
  analysisId: string,
  findingId: string,
) {
  const db = await database();
  const result = await db.execute({
    sql: `SELECT verification_json, needs_refresh, created_at, updated_at
      FROM tracked_contributions WHERE user_id = ? AND analysis_id = ? AND finding_id = ?`,
    args: [userId, analysisId, findingId],
  });
  return result.rows[0] ? verificationFromRow(result.rows[0]) : null;
}

export async function markContributionRefreshNeeded(owner: string, repo: string, pullNumber: number) {
  const db = await database();
  const result = await db.execute({
    sql: `UPDATE tracked_contributions SET needs_refresh = 1
      WHERE owner = ? AND repo = ? AND pull_number = ?`,
    args: [owner.toLowerCase(), repo.toLowerCase(), pullNumber],
  });
  return Number(result.rowsAffected ?? 0);
}
