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

let containerPromise: Promise<WebContainer> | null = null;
let activeProcesses: WebContainerProcess[] = [];

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

async function stopActiveProcesses(): Promise<void> {
  for (const process of activeProcesses) {
    try {
      process.kill();
    } catch {
      // The process may already have exited.
    }
  }
  activeProcesses = [];
}

function pipeOutput(process: WebContainerProcess, onLog: (line: string) => void): void {
  void process.output.pipeTo(
    new WritableStream<string>({
      write(chunk) {
        const line = chunk.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trim();
        if (line) onLog(line);
      },
    }),
  ).catch(() => undefined);
}

/**
 * Mounts the bundle, installs dependencies, and starts the dev server inside
 * the WebContainer. Resolves once the run has been kicked off; readiness is
 * reported through `onServerReady`.
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
    callbacks.onStatus("ready");
    callbacks.onServerReady(url);
  });
  container.on("error", (error) => {
    callbacks.onError(error.message || "The in-browser runtime reported an error.");
  });

  await container.mount(buildFileSystemTree(bundle.files));

  callbacks.onStatus("installing");
  callbacks.onLog("$ npm install");
  const install = await container.spawn("npm", ["install", "--no-audit", "--no-fund"]);
  activeProcesses.push(install);
  pipeOutput(install, callbacks.onLog);
  const installExit = await install.exit;
  if (installExit !== 0) {
    throw new Error(`npm install failed with exit code ${installExit}. Check the log for details.`);
  }

  callbacks.onStatus("starting");
  callbacks.onLog(`$ npm ${bundle.devCommand.args.join(" ")}`);
  const dev = await container.spawn("npm", bundle.devCommand.args);
  activeProcesses.push(dev);
  pipeOutput(dev, callbacks.onLog);
  void dev.exit.then((code) => {
    if (code !== 0) {
      callbacks.onError(`The dev server exited with code ${code}. Check the log for details.`);
    }
  });
}

/** Stops any running preview processes (used when resetting the session). */
export async function stopPreview(): Promise<void> {
  await stopActiveProcesses();
}
