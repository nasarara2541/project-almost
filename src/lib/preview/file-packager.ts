import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PreviewFile } from "../../types/api";

/**
 * Packages a repository's source tree into a JSON-safe file list that the
 * browser can mount into a WebContainer. The server never builds or runs
 * anything: it only reads files. Execution happens entirely client-side.
 */

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".vercel",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wasm",
  ".pdf",
  ".zip",
]);

const MAX_FILES = 2_000;
const MAX_TEXT_FILE_BYTES = 1024 * 1024; // 1 MB per text file
const MAX_BINARY_FILE_BYTES = 512 * 1024; // 512 KB per binary asset
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB per preview bundle

export class PreviewPackagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewPackagingError";
  }
}

function isProbablyBinary(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function packageRepositoryFiles(sourceRoot: string): Promise<PreviewFile[]> {
  const root = path.resolve(sourceRoot);
  const rootMetadata = await stat(root).catch(() => null);
  if (!rootMetadata?.isDirectory()) {
    throw new PreviewPackagingError("The repository source directory could not be read.");
  }

  const files: PreviewFile[] = [];
  let totalBytes = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      // Never ship environment files to the browser.
      if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
      if (entry.isSymbolicLink()) continue;

      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const metadata = await stat(entryPath);
      const binary = isProbablyBinary(entryPath);
      const perFileLimit = binary ? MAX_BINARY_FILE_BYTES : MAX_TEXT_FILE_BYTES;
      if (metadata.size > perFileLimit) continue; // skip oversized assets, keep going

      totalBytes += metadata.size;
      if (files.length + 1 > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
        throw new PreviewPackagingError(
          `This repository exceeds the live-preview bundle limit (${MAX_FILES} files / ${MAX_TOTAL_BYTES / 1024 / 1024} MB). Try a smaller repository or subproject.`,
        );
      }

      const relativePath = path.relative(root, entryPath).split(path.sep).join("/");
      const contents = await readFile(entryPath);
      files.push(
        binary
          ? { path: relativePath, contents: contents.toString("base64"), encoding: "base64" }
          : { path: relativePath, contents: contents.toString("utf8"), encoding: "utf8" },
      );
    }
  }

  await visit(root);

  if (!files.some((file) => file.path === "package.json")) {
    throw new PreviewPackagingError("The selected project root does not contain a package.json file.");
  }

  return files;
}

/** Picks the npm script the browser runtime should run after `npm install`. */
export function selectDevCommand(scripts: string[]): { script: string; args: string[] } | null {
  const preferred = ["dev", "start", "serve", "preview"];
  for (const name of preferred) {
    if (scripts.includes(name)) return { script: name, args: ["run", name] };
  }
  return null;
}
