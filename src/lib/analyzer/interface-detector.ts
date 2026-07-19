import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  CodeLocation,
  InterfaceComponent,
  InterfaceReport,
  InterfaceRole,
  InterfaceScreen,
  LanguageStat,
  RepositoryProjectInfo,
} from "../../types/api";
import {
  renderJsxWireframe,
  sanitizeCss,
  sanitizeHtmlDocument,
  sanitizeHtmlFragment,
  wireframeDocument,
  type AssetResolver,
} from "../preview/static-preview";
import type { ParsedSourceFile } from "./parser";

/**
 * Detects the visual interface contained in a repository — HTML pages,
 * route/page components, Chrome-extension popups, standalone components,
 * styles, and assets — and reconstructs safe static previews for them.
 * Nothing here executes repository code.
 */

const IGNORED_DIRECTORIES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage", "__pycache__", ".turbo", ".vercel",
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg"]);
const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript",
  ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
  ".html": "HTML", ".htm": "HTML",
  ".css": "CSS", ".scss": "SCSS", ".sass": "SCSS", ".less": "Less",
  ".py": "Python", ".rb": "Ruby", ".go": "Go", ".rs": "Rust", ".java": "Java",
  ".kt": "Kotlin", ".swift": "Swift", ".php": "PHP", ".c": "C", ".h": "C",
  ".cpp": "C++", ".cc": "C++", ".cs": "C#", ".sh": "Shell",
  ".json": "JSON", ".md": "Markdown", ".yml": "YAML", ".yaml": "YAML", ".toml": "TOML",
};

const MAX_INVENTORY_FILES = 4_000;
const MAX_HTML_SCREENS = 12;
const MAX_COMPONENTS = 80;
const MAX_COMPONENT_PREVIEWS = 30;
const MAX_ASSET_DATA_URI_BYTES = 256 * 1024;
const MAX_PROJECT_CSS_BYTES = 100 * 1024;

export type WorkspaceFile = { path: string; size: number };

export type WorkspaceInventory = {
  files: WorkspaceFile[];
  languages: LanguageStat[];
  folders: string[];
  importantFiles: string[];
};

export type DetectedRouteScreen = {
  route: string;
  file: string;
  componentName?: string;
  location: CodeLocation;
};

/** Walks the fetched workspace once and summarizes its shape. */
export async function inventoryWorkspace(sourcePath: string): Promise<WorkspaceInventory> {
  const files: WorkspaceFile[] = [];

  async function visit(directory: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(absolute, relativePath);
      } else if (entry.isFile() && files.length < MAX_INVENTORY_FILES) {
        const metadata = await stat(absolute).catch(() => null);
        if (metadata) files.push({ path: relativePath, size: metadata.size });
      }
    }
  }
  await visit(sourcePath, "");
  files.sort((a, b) => a.path.localeCompare(b.path));

  const byLanguage = new Map<string, { files: number; bytes: number }>();
  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION[path.posix.extname(file.path).toLowerCase()];
    if (!language) continue;
    const entry = byLanguage.get(language) ?? { files: 0, bytes: 0 };
    entry.files += 1;
    entry.bytes += file.size;
    byLanguage.set(language, entry);
  }
  const totalBytes = [...byLanguage.values()].reduce((total, entry) => total + entry.bytes, 0);
  const languages: LanguageStat[] = [...byLanguage.entries()]
    .map(([name, entry]) => ({
      name,
      files: entry.files,
      bytes: entry.bytes,
      percent: totalBytes > 0 ? Math.round((entry.bytes / totalBytes) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  // Folder outline: directories up to two levels deep, with file counts.
  const directoryCounts = new Map<string, number>();
  for (const file of files) {
    const segments = file.path.split("/");
    for (let depth = 1; depth < Math.min(segments.length, 3); depth += 1) {
      const key = segments.slice(0, depth).join("/");
      directoryCounts.set(key, (directoryCounts.get(key) ?? 0) + 1);
    }
  }
  const folders = [...directoryCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 60)
    .map(([directory, count]) => `${directory}/ (${count} files)`);

  const importantNames = new Set([
    "package.json", "manifest.json", "index.html", "vite.config.ts", "vite.config.js",
    "next.config.ts", "next.config.js", "next.config.mjs", "tailwind.config.js",
    "tailwind.config.ts", "pyproject.toml", "requirements.txt", "setup.py", "go.mod",
    "cargo.toml", "gemfile", "composer.json", "readme.md", "dockerfile", "makefile",
    "tsconfig.json", "svelte.config.js", "astro.config.mjs", "nuxt.config.ts",
  ]);
  const importantFiles = files
    .filter((file) => importantNames.has(path.posix.basename(file.path).toLowerCase()) && file.path.split("/").length <= 3)
    .map((file) => file.path)
    .slice(0, 24);

  return { files, languages, folders, importantFiles };
}

type ResolverBundle = {
  resolver: AssetResolver;
  loadText: (relativePath: string) => Promise<string | null>;
};

/**
 * Builds an AssetResolver over the fetched workspace. Text and asset files
 * that previews reference are pre-loaded (bounded) so sanitization stays
 * synchronous.
 */
async function buildResolver(
  sourcePath: string,
  inventory: WorkspaceInventory,
): Promise<ResolverBundle> {
  const textCache = new Map<string, string>();
  const assetCache = new Map<string, string>();
  const root = path.resolve(sourcePath);

  const loadText = async (relativePath: string): Promise<string | null> => {
    if (textCache.has(relativePath)) return textCache.get(relativePath)!;
    const absolute = path.resolve(root, relativePath);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return null;
    const contents = await readFile(absolute, "utf8").catch(() => null);
    if (contents !== null) textCache.set(relativePath, contents);
    return contents;
  };

  // Pre-load small images as data URIs so <img> tags can be inlined.
  const imageFiles = inventory.files.filter(
    (file) => IMAGE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()) && file.size <= MAX_ASSET_DATA_URI_BYTES,
  );
  for (const file of imageFiles.slice(0, 80)) {
    const absolute = path.resolve(root, file.path);
    const bytes = await readFile(absolute).catch(() => null);
    if (!bytes) continue;
    const mime = IMAGE_MIME[path.posix.extname(file.path).toLowerCase()] ?? "application/octet-stream";
    assetCache.set(file.path, `data:${mime};base64,${bytes.toString("base64")}`);
  }

  // Pre-load style files so <link rel=stylesheet> can be inlined.
  const styleFiles = inventory.files.filter((file) =>
    STYLE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()),
  );
  for (const file of styleFiles.slice(0, 40)) await loadText(file.path);

  const resolver: AssetResolver = {
    readText: (relativePath) => textCache.get(relativePath) ?? null,
    readAssetDataUri: (relativePath) => assetCache.get(relativePath) ?? null,
  };
  return { resolver, loadText };
}

export function inferInterfaceRole(name: string): InterfaceRole {
  const target = name.toLowerCase();
  if (/(nav|menu|sidebar|breadcrumb|tabbar|tabs)/.test(target)) return "navigation";
  if (/(modal|dialog|popup|popover|drawer|tooltip|toast|sheet)/.test(target)) return "modal";
  if (/(form|login|signup|signin|register|search|field|checkout)/.test(target)) return "form";
  if (/(table|datagrid|grid)/.test(target)) return "table";
  if (/(card|tile)/.test(target)) return "card";
  if (/(chart|graph|plot|gauge|metric|stat|sparkline)/.test(target)) return "chart";
  if (/(toggle|switch|slider|checkbox|radio|select|dropdown|picker|stepper|pagination)/.test(target)) return "control";
  if (/(button|btn|cta)/.test(target)) return "button";
  if (/(image|img|avatar|icon|logo|banner|carousel|gallery|video|media)/.test(target)) return "media";
  if (/(list|feed|timeline)/.test(target)) return "list";
  if (/(layout|shell|header|footer|wrapper|container|section|hero)/.test(target)) return "layout";
  if (/(page|screen|view|dashboard|home|landing)$/.test(target) || /(page|screen|view)s?$/.test(target)) return "page";
  return "widget";
}

/** Extracts human-readable control labels from sanitized popup/page HTML. */
export function extractControls(html: string): string[] {
  const controls: string[] = [];
  const push = (label: string) => {
    const cleaned = label.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (cleaned && !controls.includes(cleaned) && controls.length < 20) controls.push(cleaned);
  };
  for (const match of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) push(`Button: ${match[1]}`);
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const type = tag.match(/\stype\s*=\s*["']?([a-z-]+)/i)?.[1] ?? "text";
    const label =
      tag.match(/\splaceholder\s*=\s*"([^"]*)"/i)?.[1] ??
      tag.match(/\sname\s*=\s*"([^"]*)"/i)?.[1] ??
      tag.match(/\sid\s*=\s*"([^"]*)"/i)?.[1] ??
      "";
    push(`Input (${type})${label ? `: ${label}` : ""}`);
  }
  for (const match of html.matchAll(/<select\b[^>]*>/gi)) {
    const label = match[0].match(/\s(?:name|id)\s*=\s*"([^"]*)"/i)?.[1] ?? "";
    push(`Select${label ? `: ${label}` : ""}`);
  }
  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) push(`Link: ${match[1]}`);
  return controls;
}

type ChromeManifest = {
  name?: string;
  manifest_version?: number;
  action?: { default_popup?: string; default_title?: string };
  browser_action?: { default_popup?: string; default_title?: string };
  page_action?: { default_popup?: string };
  options_page?: string;
  options_ui?: { page?: string };
  icons?: Record<string, string>;
  content_scripts?: Array<{ js?: string[]; css?: string[]; matches?: string[] }>;
};

async function readChromeManifest(
  sourcePath: string,
): Promise<{ manifest: ChromeManifest; manifestPath: string; baseDir: string } | null> {
  for (const candidate of ["manifest.json", "public/manifest.json", "src/manifest.json", "extension/manifest.json"]) {
    const absolute = path.join(sourcePath, candidate);
    try {
      const manifest = JSON.parse(await readFile(absolute, "utf8")) as ChromeManifest;
      if (typeof manifest.manifest_version === "number") {
        return { manifest, manifestPath: candidate, baseDir: path.posix.dirname(candidate) };
      }
    } catch {
      // Not a Chrome manifest — keep looking.
    }
  }
  return null;
}

function subprojectRootFor(file: string, project: RepositoryProjectInfo): string {
  let best = ".";
  for (const subproject of project.subprojects) {
    if (subproject.root === ".") continue;
    if (file === subproject.root || file.startsWith(`${subproject.root}/`)) {
      if (subproject.root.length > best.length || best === ".") best = subproject.root;
    }
  }
  return best;
}

function htmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1]?.replace(/\s+/g, " ").trim();
  return title || null;
}

function referencedAssets(html: string, htmlDir: string): string[] {
  const assets = new Set<string>();
  for (const match of html.matchAll(/<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) {
    const reference = match[1];
    if (/^(?:data:|https?:|\/\/)/i.test(reference)) continue;
    const resolved = reference.startsWith("/")
      ? reference.slice(1)
      : path.posix.normalize(path.posix.join(htmlDir === "." ? "" : htmlDir, reference));
    if (!resolved.startsWith("../")) assets.add(resolved);
  }
  return [...assets];
}

function referencedStyles(html: string, htmlDir: string): string[] {
  const styles = new Set<string>();
  for (const match of html.matchAll(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(match[0])) continue;
    const reference = match[1];
    if (/^(?:https?:|\/\/)/i.test(reference)) continue;
    const resolved = reference.startsWith("/")
      ? reference.slice(1)
      : path.posix.normalize(path.posix.join(htmlDir === "." ? "" : htmlDir, reference.split(/[?#]/)[0]));
    if (!resolved.startsWith("../")) styles.add(resolved);
  }
  return [...styles];
}

function styleImportsOf(file: ParsedSourceFile): string[] {
  return file.imports
    .filter((imported) => /\.(css|scss|sass|less)$/i.test(imported.specifier))
    .map((imported) =>
      path.posix.normalize(
        path.posix.join(path.posix.dirname(file.relativePath), imported.specifier),
      ),
    )
    .filter((resolved) => !resolved.startsWith("../"));
}

async function projectCss(
  styleFiles: string[],
  loadText: (relativePath: string) => Promise<string | null>,
): Promise<string> {
  let combined = "";
  for (const styleFile of styleFiles) {
    if (combined.length >= MAX_PROJECT_CSS_BYTES) break;
    if (!/\.css$/i.test(styleFile)) continue; // only plain CSS can be inlined as-is
    const css = await loadText(styleFile);
    if (css) combined += `\n/* ${styleFile} */\n${sanitizeCss(css)}`;
  }
  return combined.slice(0, MAX_PROJECT_CSS_BYTES);
}

function vueTemplate(source: string): string | null {
  const match = source.match(/<template[^>]*>([\s\S]*)<\/template>/i);
  return match?.[1] ?? null;
}

function svelteMarkup(source: string): string {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/\{[#:/@][^}]*\}/g, "")
    .replace(/\{[^{}]*\}/g, '<span class="rl-expr">…</span>');
}

function astroMarkup(source: string): string {
  return source.replace(/^---[\s\S]*?---\s*/m, "");
}

export async function detectInterface(options: {
  sourcePath: string;
  parsedFiles: ParsedSourceFile[];
  routes: DetectedRouteScreen[];
  project: RepositoryProjectInfo;
  inventory: WorkspaceInventory;
}): Promise<InterfaceReport> {
  const { sourcePath, parsedFiles, routes, project, inventory } = options;
  const { resolver, loadText } = await buildResolver(sourcePath, inventory);

  const styleFiles = inventory.files
    .filter((file) => STYLE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()))
    .map((file) => file.path);
  const images = inventory.files
    .filter((file) => IMAGE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()))
    .map((file) => file.path);
  const icons = images.filter((file) => /(^|\/)(icons?|favicon|logo)[^/]*$|icon[^/]*\.(png|svg|ico)$/i.test(file));

  const tailwind =
    inventory.files.some((file) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(file.path)) ||
    (await Promise.all(styleFiles.slice(0, 10).map(loadText))).some((css) =>
      css ? /@tailwind\b|@import\s+["']tailwindcss/.test(css) : false,
    );

  const screens: InterfaceScreen[] = [];
  const claimedHtml = new Set<string>();

  // 1. Chrome extension surfaces (popup, options) come first: they ARE the UI.
  const extension = await readChromeManifest(sourcePath);
  if (extension) {
    const { manifest, baseDir } = extension;
    const pages: Array<{ kind: InterfaceScreen["kind"]; file?: string; name: string }> = [
      {
        kind: "popup",
        file: manifest.action?.default_popup ?? manifest.browser_action?.default_popup ?? manifest.page_action?.default_popup,
        name: manifest.action?.default_title ?? manifest.browser_action?.default_title ?? "Extension popup",
      },
      { kind: "options", file: manifest.options_page ?? manifest.options_ui?.page, name: "Extension options" },
    ];
    for (const page of pages) {
      if (!page.file) continue;
      const relative = path.posix.normalize(
        path.posix.join(baseDir === "." ? "" : baseDir, page.file),
      );
      const html = await loadText(relative);
      if (html === null) continue;
      claimedHtml.add(relative);
      const previewHtml = sanitizeHtmlDocument(html, relative, resolver);
      screens.push({
        id: `screen:${page.kind}:${relative}`,
        name: htmlTitle(html) ?? page.name,
        kind: page.kind,
        file: relative,
        location: { file: relative, lineStart: 1 },
        componentNames: [],
        styles: referencedStyles(html, path.posix.dirname(relative)),
        assets: referencedAssets(html, path.posix.dirname(relative)),
        controls: extractControls(previewHtml),
        previewHtml,
        subprojectRoot: subprojectRootFor(relative, project),
      });
    }
    for (const contentScript of manifest.content_scripts ?? []) {
      const files = [...(contentScript.js ?? []), ...(contentScript.css ?? [])];
      if (files.length === 0) continue;
      const first = path.posix.normalize(path.posix.join(baseDir === "." ? "" : baseDir, files[0]));
      screens.push({
        id: `screen:content-script:${first}`,
        name: `Content script UI (${(contentScript.matches ?? ["all pages"]).join(", ")})`,
        kind: "content-script",
        file: first,
        location: { file: first, lineStart: 1 },
        componentNames: [],
        styles: (contentScript.css ?? []).map((file) =>
          path.posix.normalize(path.posix.join(baseDir === "." ? "" : baseDir, file)),
        ),
        assets: [],
        controls: [],
        previewHtml: null,
        subprojectRoot: subprojectRootFor(first, project),
      });
    }
  }

  // 2. Plain HTML pages (including framework index.html shells).
  const htmlFiles = inventory.files
    .filter((file) => /\.html?$/i.test(file.path) && !claimedHtml.has(file.path))
    .slice(0, MAX_HTML_SCREENS);
  for (const file of htmlFiles) {
    const html = await loadText(file.path);
    if (html === null) continue;
    const previewHtml = sanitizeHtmlDocument(html, file.path, resolver);
    const basename = path.posix.basename(file.path);
    screens.push({
      id: `screen:page:${file.path}`,
      name: htmlTitle(html) ?? basename,
      kind: "page",
      route: basename === "index.html" && !file.path.includes("/") ? "/" : undefined,
      file: file.path,
      location: { file: file.path, lineStart: 1 },
      componentNames: [],
      styles: referencedStyles(html, path.posix.dirname(file.path)),
      assets: referencedAssets(html, path.posix.dirname(file.path)),
      controls: extractControls(previewHtml),
      previewHtml,
      subprojectRoot: subprojectRootFor(file.path, project),
    });
  }

  const parsedByPath = new Map(parsedFiles.map((file) => [file.relativePath, file]));

  // 3. Route/page components get wireframe previews with the project's CSS.
  const routeComponentKeys = new Set<string>();
  for (const route of routes) {
    const parsed = parsedByPath.get(route.file);
    const source = await loadText(route.file);
    const styles = parsed ? styleImportsOf(parsed) : [];
    const fragment = source ? renderJsxWireframe(source, route.file, route.componentName) : null;
    const css = await projectCss([...styles, ...styleFiles.slice(0, 4)], loadText);
    if (route.componentName) routeComponentKeys.add(`${route.file}#${route.componentName}`);
    screens.push({
      id: `screen:route:${route.route}:${route.file}`,
      name: route.componentName ?? route.route,
      kind: "route",
      route: route.route,
      file: route.file,
      location: route.location,
      componentNames: parsed ? parsed.components.map((component) => component.name) : [],
      styles,
      assets: [],
      controls: fragment ? extractControls(fragment) : [],
      previewHtml: fragment ? wireframeDocument(fragment, css) : null,
      subprojectRoot: subprojectRootFor(route.file, project),
    });
  }

  // 4. Vue/Svelte/Astro single-file components.
  const sfcFiles = inventory.files.filter((file) => /\.(vue|svelte|astro)$/i.test(file.path)).slice(0, 40);
  const components: InterfaceComponent[] = [];
  for (const file of sfcFiles) {
    const source = await loadText(file.path);
    if (source === null) continue;
    const extension = path.posix.extname(file.path).toLowerCase();
    const markup =
      extension === ".vue" ? vueTemplate(source) : extension === ".svelte" ? svelteMarkup(source) : astroMarkup(source);
    const name = path.posix.basename(file.path).replace(/\.(vue|svelte|astro)$/i, "");
    const fragment = markup ? sanitizeHtmlFragment(markup, file.path, resolver) : null;
    components.push({
      name,
      file: file.path,
      location: { file: file.path, lineStart: 1 },
      role: inferInterfaceRole(name),
      previewHtml: fragment?.trim() ? wireframeDocument(fragment) : null,
      subprojectRoot: subprojectRootFor(file.path, project),
    });
  }

  // 5. React/JSX components that are not already route screens.
  let componentPreviewBudget = MAX_COMPONENT_PREVIEWS;
  for (const file of parsedFiles) {
    for (const component of file.components) {
      if (components.length >= MAX_COMPONENTS) break;
      if (routeComponentKeys.has(`${file.relativePath}#${component.name}`)) continue;
      let previewHtml: string | null = null;
      if (componentPreviewBudget > 0) {
        const source = await loadText(file.relativePath);
        const fragment = source
          ? renderJsxWireframe(source, file.relativePath, component.name)
          : null;
        if (fragment) {
          const css = await projectCss(styleImportsOf(file), loadText);
          previewHtml = wireframeDocument(fragment, css);
          componentPreviewBudget -= 1;
        }
      }
      components.push({
        name: component.name,
        file: file.relativePath,
        location: component.location,
        role: inferInterfaceRole(component.name),
        previewHtml,
        subprojectRoot: subprojectRootFor(file.relativePath, project),
      });
    }
  }

  const hasVisualInterface = screens.some((screen) => screen.previewHtml) || components.length > 0;
  const summary = extension
    ? "Chrome extension interface: popup and controls reconstructed from the extension's source."
    : screens.length > 0 || components.length > 0
      ? `Detected ${screens.length} screen${screens.length === 1 ? "" : "s"} and ${components.length} component${components.length === 1 ? "" : "s"} reconstructed from source.`
      : "No visual interface detected.";

  return {
    hasVisualInterface,
    summary,
    message: hasVisualInterface
      ? undefined
      : "No visual interface detected. This repository appears to be a CLI, library, backend, or data project.",
    screens,
    components,
    styleFiles,
    tailwind,
    images,
    icons,
  };
}
