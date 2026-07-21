import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

type DatabaseState = {
  client?: Client;
  ready?: Promise<void>;
  schemaVersion?: number;
};

const SCHEMA_VERSION = 2;

function databaseUrl() {
  const configured = process.env.TURSO_DATABASE_URL?.trim();
  if (configured) return configured;
  const directory = path.join(process.cwd(), ".data");
  mkdirSync(directory, { recursive: true });
  return `file:${path.join(directory, "repolens.db")}`;
}

function initializeDatabase(state: DatabaseState) {
  const client = state.client ?? createClient({
    url: databaseUrl(),
    authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
  });
  state.client = client;
  state.schemaVersion = SCHEMA_VERSION;
  state.ready = client.batch([
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_id INTEGER NOT NULL UNIQUE,
      login TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      access_expires_at TEXT,
      refresh_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS saved_analyses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      parent_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS saved_analyses_user_created
      ON saved_analyses(user_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS contribution_feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      verdict TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, analysis_id, finding_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (analysis_id) REFERENCES saved_analyses(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS tracked_contributions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      pull_request_url TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      pull_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      verification_json TEXT NOT NULL,
      needs_refresh INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, analysis_id, finding_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (analysis_id) REFERENCES saved_analyses(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS tracked_contributions_analysis
      ON tracked_contributions(user_id, analysis_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS tracked_contributions_pull
      ON tracked_contributions(owner, repo, pull_number)`,
  ], "write").then(() => undefined).catch((error) => {
    state.schemaVersion = 0;
    throw error;
  });
}

declare global {
  var __repoLensDatabase: DatabaseState | undefined;
}

const state = globalThis.__repoLensDatabase ?? {};
if (process.env.NODE_ENV !== "production") globalThis.__repoLensDatabase = state;

export async function database() {
  if (!state.client || !state.ready || state.schemaVersion !== SCHEMA_VERSION) initializeDatabase(state);
  await state.ready;
  return state.client as Client;
}
