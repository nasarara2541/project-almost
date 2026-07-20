"use client";

import type { FileSystemTree, WebContainer, WebContainerProcess } from "@webcontainer/api";
import type { PreviewBundle, PreviewFile } from "../../types/api";

/**
 * Runs a repository entirely inside the visitor's browser using
 * WebContainers (the technology behind StackBlitz). The Next.js server only
 * supplies source files; `npm install` and the dev server both execute in a
 * sandboxed in-browser Node.js runtime, so nothing runs on shared server
 * infrastructure and no server process needs to stay alive.
 *
 * Requires cross-origin isolation (COOP/COEP headers in next.config.ts).
 */

const INSTALL_TIMEOUT_MS = 120_000;
const SERVER_READY_TIMEOUT_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

let containerPromise: Promise<WebContainer> | null = null;
let activeProcesses: WebContainerProcess[] = [];
let readyTimeoutId: number | null = null;

async function getContainer(): Promise<WebContainer> {
  if (!containerPromise) {
    containerPromise = import("@webcontainer/api").then(({ WebContainer }) =>
      WebContainer.boot({ workdirName: "repolens" }),
    );
  }
  return containerPromise;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Converts the flat server file list into a WebContainer FileSystemTree. */
export function buildFileSystemTree(files: PreviewFile[]): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let cursor = tree;

    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      const existing = cursor[segment];
      if (existing && "directory" in existing) {
        cursor = existing.directory;
      } else {
        const directory: FileSystemTree = {};
        cursor[segment] = { directory };
        cursor = directory;
      }
    }

    cursor[segments[segments.length - 1]] = {
      file: {
        contents:
          file.encoding === "base64" ? base64ToBytes(file.contents) : file.contents,
      },
    };
  }

  return tree;
}

export type PreviewRunCallbacks = {
  onStatus: (status: "booting" | "installing" | "starting" | "ready") => void;
  onLog: (line: string) => void;
  onServerReady: (url: string) => void;
  onError: (message: string) => void;
};

function clearReadyTimeout(): void {
  if (readyTimeoutId !== null) {
    window.clearTimeout(readyTimeoutId);
    readyTimeoutId = null;
  }
}

async function stopActiveProcesses(): Promise<void> {
  clearReadyTimeout();
  for (const process of activeProcesses) {
    try {
      process.kill();
    } catch {
      // The process may already have exited.
    }
  }
  activeProcesses = [];
}

/**
 * A bare progress-bar frame (npm's spinner, redrawn via carriage returns) has
 * nothing worth showing on its own line. These are dropped entirely; a
 * heartbeat message takes over responsibility for "is this still alive."
 */
function isProgressFrameNoise(line: string): boolean {
  return /^[-\\|/⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏.]+$/.test(line);
}

function pipeOutput(process: WebContainerProcess, onLog: (line: string) => void): void {
  void process.output.pipeTo(
    new WritableStream<string>({
      write(chunk) {
        const line = chunk.replace(/\[[0-9;]*[A-Za-z]/g, "").trim();
        if (!line || isProgressFrameNoise(line)) return;
        onLog(line);
      },
    }),
  ).catch(() => undefined);
}

/** Emits a periodic "still working" line so a slow step reads as active, not frozen. */
function startHeartbeat(onLog: (line: string) => void, label: string) {
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    onLog(`… ${label}, still running (${elapsedSeconds}s elapsed)`);
  }, HEARTBEAT_INTERVAL_MS);
  return { stop: () => window.clearInterval(timer) };
}

/** Rejects with `message` if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Mounts the bundle, installs dependencies, and starts the dev server inside
 * the WebContainer. Resolves once the run has been kicked off; readiness is
 * reported through `onServerReady`. Both the install step and the wait for
 * the dev server to report ready are time-bounded, so a stuck or
 * incompatible repository fails with a clear message instead of spinning
 * forever.
 */
export async function runPreviewBundle(
  bundle: PreviewBundle,
  callbacks: PreviewRunCallbacks,
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("The in-browser preview can only run in a browser.");
  }
  if (!window.crossOriginIsolated) {
    throw new Error(
      "This page is not cross-origin isolated, so the in-browser runtime cannot boot. " +
        "Confirm the Cross-Origin-Embedder-Policy and Cross-Origin-Opener-Policy headers in next.config.ts are deployed.",
    );
  }

  callbacks.onStatus("booting");
  const container = await getContainer();
  await stopActiveProcesses();

  container.on("server-ready", (_port, url) => {
    clearReadyTimeout();
    callbacks.onStatus("ready");
    callbacks.onServerReady(url);
  });
  container.on("error", (error) => {
    clearReadyTimeout();
    callbacks.onError(error.message || "The in-browser runtime reported an error.");
  });

  await container.mount(buildFileSystemTree(bundle.files));

  callbacks.onStatus("installing");
  callbacks.onLog("$ npm install");
  const install = await container.spawn("npm", ["install", "--no-audit", "--no-fund"]);
  activeProcesses.push(install);
  pipeOutput(install, callbacks.onLog);

  const installHeartbeat = startHeartbeat(callbacks.onLog, "installing dependencies");
  let installExit: number;
  try {
    installExit = await withTimeout(
      install.exit,
      INSTALL_TIMEOUT_MS,
      `npm install did not finish within ${INSTALL_TIMEOUT_MS / 1000}s. This usually means the ` +
        "dependency tree is unusually large, missing a lockfile, or includes a package that " +
        "needs a native build step the in-browser runtime cannot run.",
    );
  } catch (error) {
    void install.kill();
    throw error instanceof Error ? error : new Error("npm install did not finish in time.");
  } finally {
    installHeartbeat.stop();
  }
  if (installExit !== 0) {
    throw new Error(`npm install failed with exit code ${installExit}. Check the log for details.`);
  }

  callbacks.onStatus("starting");
  callbacks.onLog(`$ npm ${bundle.devCommand.args.join(" ")}`);
  const dev = await container.spawn("npm", bundle.devCommand.args);
  activeProcesses.push(dev);
  pipeOutput(dev, callbacks.onLog);

  clearReadyTimeout();
  readyTimeoutId = window.setTimeout(() => {
    callbacks.onError(
      `The dev server did not report ready within ${SERVER_READY_TIMEOUT_MS / 1000}s. It may have ` +
        "crashed on startup or be listening on a port the runtime did not detect. Check the log for details.",
    );
  }, SERVER_READY_TIMEOUT_MS);

  void dev.exit.then((code) => {
    if (code !== 0) {
      clearReadyTimeout();
      callbacks.onError(`The dev server exited with code ${code}. Check the log for details.`);
    }
  });
}

/** Stops any running preview processes (used when resetting the session). */
export async function stopPreview(): Promise<void> {
  await stopActiveProcesses();
}
