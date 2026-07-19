import path from "node:path";
import ts from "typescript";

/**
 * Safe, static interface previews reconstructed from repository source.
 *
 * Nothing in this module executes repository code. Real HTML pages are
 * sanitized (scripts, event handlers, embeds, and external references are
 * removed; local styles and images are inlined), and JSX components are
 * converted into script-free wireframe documents. The output is only ever
 * rendered inside `<iframe sandbox="" srcDoc={...}>`, which disallows script
 * execution entirely even if something slipped through.
 */

export type AssetResolver = {
  /** Returns the UTF-8 contents of a repository text file, or null. */
  readText: (relativePath: string) => string | null;
  /** Returns a small binary asset as a data URI, or null. */
  readAssetDataUri: (relativePath: string) => string | null;
};

const MAX_PREVIEW_HTML_BYTES = 400 * 1024;
const MAX_INLINE_CSS_BYTES = 120 * 1024;
const MAX_WIREFRAME_NODES = 400;
const MAX_WIREFRAME_DEPTH = 40;

export const PLACEHOLDER_IMAGE_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" rx="8" fill="#e2e8f0"/><path d="M28 56l18-20 14 14 10-10 22 16z" fill="#94a3b8"/><circle cx="42" cy="30" r="7" fill="#94a3b8"/></svg>',
  );

const BLOCKED_ELEMENTS = ["script", "iframe", "frame", "object", "embed", "applet", "base", "noscript"];

function stripBlockedElements(html: string): string {
  let output = html;
  for (const tag of BLOCKED_ELEMENTS) {
    output = output
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "")
      .replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  return output;
}

function stripDangerousAttributes(tag: string): string {
  return tag
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, "")
    .replace(/\ssrcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\saction\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** Removes remote imports/urls from CSS so previews never phone home. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import\b[^;]*;/gi, "")
    .replace(/url\(\s*(["']?)\s*(?:https?:)?\/\/[^)]*\)/gi, "none")
    .replace(/url\(\s*(["']?)\s*javascript:[^)]*\)/gi, "none")
    .replace(/expression\s*\(/gi, "none(")
    .slice(0, MAX_INLINE_CSS_BYTES);
}

function resolveReference(reference: string, htmlDir: string): string | null {
  const cleaned = reference.trim().replace(/^["']|["']$/g, "").split(/[?#]/)[0];
  if (!cleaned || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(cleaned)) return null;
  const joined = cleaned.startsWith("/")
    ? cleaned.slice(1)
    : path.posix.join(htmlDir === "." ? "" : htmlDir, cleaned);
  const normalized = path.posix.normalize(joined);
  if (normalized.startsWith("../") || normalized.startsWith("/")) return null;
  return normalized;
}

/**
 * Sanitizes a full HTML document from the repository into a script-free,
 * self-contained preview document. Local stylesheets are inlined (sanitized)
 * and local images become data URIs; every external or unresolvable
 * reference is replaced with a neutral placeholder.
 */
export function sanitizeHtmlDocument(
  html: string,
  htmlFilePath: string,
  resolver: AssetResolver,
): string {
  const htmlDir = path.posix.dirname(htmlFilePath.replaceAll("\\", "/"));
  let output = html.replace(/<!--[\s\S]*?-->/g, "");
  output = stripBlockedElements(output);

  // Inline local stylesheets; drop every other <link>.
  output = output.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet["']?/i.test(tag)) return "";
    const href = tag.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const reference = href?.[2] ?? href?.[3] ?? href?.[4];
    const resolved = reference ? resolveReference(reference, htmlDir) : null;
    const css = resolved ? resolver.readText(resolved) : null;
    return css ? `<style>${sanitizeCss(css)}</style>` : "";
  });

  // Sanitize inline <style> blocks.
  output = output.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_tag, css: string) => {
    return `<style>${sanitizeCss(css)}</style>`;
  });

  // Rewrite images: local files become data URIs, everything else a placeholder.
  output = output.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const reference = src?.[2] ?? src?.[3] ?? src?.[4];
    const resolved = reference?.startsWith("data:")
      ? null
      : reference
        ? resolveReference(reference, htmlDir)
        : null;
    const dataUri = reference?.startsWith("data:")
      ? reference
      : (resolved ? resolver.readAssetDataUri(resolved) : null) ?? PLACEHOLDER_IMAGE_DATA_URI;
    const withoutSrcSet = tag.replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return withoutSrcSet.replace(/\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, ` src="${dataUri}"`);
  });

  // Strip event handlers and javascript: URLs from every remaining tag.
  output = output.replace(/<[a-z][^>]*>/gi, (tag) => stripDangerousAttributes(tag));

  return output.slice(0, MAX_PREVIEW_HTML_BYTES);
}

/** Sanitizes an HTML fragment (e.g. a Vue template) with the same rules. */
export function sanitizeHtmlFragment(
  fragment: string,
  filePath: string,
  resolver: AssetResolver,
): string {
  const cleaned = sanitizeHtmlDocument(fragment, filePath, resolver)
    // Framework template syntax renders as visual filler, not raw braces.
    .replace(/\{\{[\s\S]*?\}\}/g, "…")
    .replace(/<([a-z][^>]*)>/gi, (tag) =>
      tag.replace(/\s(?:v-[a-z:-]+|@[a-z.:-]+|:[a-z.:-]+|x-[a-z:-]+|on:[a-z|]+|bind:[a-z]+|use:[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ""),
    );
  return cleaned;
}

const WIREFRAME_BASE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2937; background: #ffffff; line-height: 1.45; }
  h1, h2, h3, h4 { margin: 0.4em 0; line-height: 1.2; }
  nav, header { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
  footer { border-top: 1px solid #e5e7eb; padding: 10px 12px; color: #6b7280; }
  section, article, main, aside { display: block; padding: 6px 0; }
  button, input[type="submit"] { background: #111827; color: #ffffff; border: 0; border-radius: 8px; padding: 8px 14px; font-size: 13px; }
  a { color: #2563eb; text-decoration: none; }
  input, select, textarea { border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px; font-size: 13px; background: #fff; width: auto; max-width: 100%; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 10px; font-size: 13px; text-align: left; }
  ul, ol { padding-left: 20px; }
  img, svg { max-width: 100%; }
  .rl-component { border: 1px dashed #94a3b8; border-radius: 10px; padding: 10px; margin: 6px 0; background: #f8fafc; }
  .rl-component::before { content: "<" attr(data-name) ">"; display: block; font-size: 10px; letter-spacing: 0.06em; color: #64748b; font-family: ui-monospace, monospace; margin-bottom: 6px; }
  .rl-expr { display: inline-block; min-width: 2.5em; border-radius: 6px; background: #e2e8f0; color: #64748b; font-size: 11px; padding: 1px 8px; text-align: center; }
  .rl-media { display: inline-block; width: 96px; height: 64px; border-radius: 8px; background: #e2e8f0 url('${PLACEHOLDER_IMAGE_DATA_URI}') center/cover no-repeat; }
`;

/** Wraps a sanitized fragment in a neutral, script-free preview document. */
export function wireframeDocument(fragmentHtml: string, extraCss = ""): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${WIREFRAME_BASE_CSS}</style>${
    extraCss ? `<style>${sanitizeCss(extraCss)}</style>` : ""
  }</head><body>${fragmentHtml}</body></html>`.slice(0, MAX_PREVIEW_HTML_BYTES);
}

const HTML_TAG_ALLOWLIST = new Set([
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
  "nav", "header", "footer", "main", "section", "article", "aside", "form",
  "button", "a", "label", "input", "select", "option", "textarea", "table",
  "thead", "tbody", "tfoot", "tr", "th", "td", "strong", "em", "small", "b",
  "i", "code", "pre", "blockquote", "hr", "br", "fieldset", "legend",
  "figure", "figcaption", "dl", "dt", "dd", "summary", "details", "caption",
]);

const KEPT_ATTRIBUTES = new Set(["placeholder", "type", "alt", "title", "value", "checked", "disabled", "colspan", "rowspan"]);

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type WireframeBudget = { nodes: number };

function jsxAttributeText(attribute: ts.JsxAttribute, sourceFile: ts.SourceFile): string | null {
  if (!attribute.initializer) return "";
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteral(attribute.initializer.expression)
  ) {
    return attribute.initializer.expression.text;
  }
  // Template literals with only static text are common for class names.
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isNoSubstitutionTemplateLiteral(attribute.initializer.expression)
  ) {
    return attribute.initializer.expression.text;
  }
  void sourceFile;
  return null;
}

function renderJsxAttributes(
  attributes: ts.JsxAttributes,
  sourceFile: ts.SourceFile,
): string {
  const parts: string[] = [];
  for (const property of attributes.properties) {
    if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) continue;
    const name = property.name.text;
    const isClass = name === "className" || name === "class";
    if (!isClass && !KEPT_ATTRIBUTES.has(name)) continue;
    const value = jsxAttributeText(property, sourceFile);
    if (value === null) continue;
    parts.push(`${isClass ? "class" : name.toLowerCase()}="${escapeHtml(value)}"`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function renderJsxChild(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  budget: WireframeBudget,
  depth: number,
): string {
  if (budget.nodes <= 0 || depth > MAX_WIREFRAME_DEPTH) return "";

  if (ts.isJsxText(node)) {
    const text = node.text.replace(/\s+/g, " ").trim();
    return text ? escapeHtml(text) : "";
  }

  if (ts.isJsxExpression(node)) {
    if (!node.expression) return "";
    return renderJsxExpression(node.expression, sourceFile, budget, depth);
  }

  if (ts.isJsxFragment(node)) {
    return node.children.map((child) => renderJsxChild(child, sourceFile, budget, depth + 1)).join("");
  }

  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    budget.nodes -= 1;
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const tagText = opening.tagName.getText(sourceFile);
    const children = ts.isJsxElement(node)
      ? node.children.map((child) => renderJsxChild(child, sourceFile, budget, depth + 1)).join("")
      : "";

    if (/^[a-z]/.test(tagText)) {
      if (tagText === "img" || tagText === "svg" || tagText === "video" || tagText === "picture") {
        return `<span class="rl-media" role="img"></span>`;
      }
      if (!HTML_TAG_ALLOWLIST.has(tagText)) {
        return `<div>${children}</div>`;
      }
      const attributes = renderJsxAttributes(opening.attributes, sourceFile);
      if (tagText === "input" || tagText === "br" || tagText === "hr") {
        return `<${tagText}${attributes}>`;
      }
      return `<${tagText}${attributes}>${children}</${tagText}>`;
    }

    // Custom component: render a labeled block so the composition stays visible.
    const label = escapeHtml(tagText.split(".").at(-1) ?? tagText);
    return `<div class="rl-component" data-name="${label}">${children}</div>`;
  }

  return "";
}

function renderJsxExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  budget: WireframeBudget,
  depth: number,
): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return escapeHtml(expression.text);
  }
  if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
    return renderJsxChild(expression, sourceFile, budget, depth);
  }
  // {condition && <Jsx/>} and {condition ? <A/> : <B/>} — show the primary branch.
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return renderJsxExpression(expression.right, sourceFile, budget, depth);
  }
  if (ts.isConditionalExpression(expression)) {
    // `loading ? <Spinner/> : <Content/>` — the loaded branch is the real UI.
    const conditionText = expression.condition.getText(sourceFile);
    const branch = /loading|pending|skeleton|isfetching|error/i.test(conditionText)
      ? expression.whenFalse
      : expression.whenTrue;
    return renderJsxExpression(branch, sourceFile, budget, depth);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return renderJsxExpression(expression.expression, sourceFile, budget, depth);
  }
  // {items.map(item => <Jsx/>)} — render the item template once.
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "map") {
    const callback = expression.arguments[0];
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      const body = callback.body;
      if (ts.isBlock(body)) {
        const returned = body.statements.find(ts.isReturnStatement)?.expression;
        return returned ? renderJsxExpression(returned, sourceFile, budget, depth) : "";
      }
      return renderJsxExpression(body, sourceFile, budget, depth);
    }
  }
  // Any other dynamic value renders as a neutral data pill.
  const raw = expression.getText(sourceFile).replace(/\s+/g, " ");
  const short = raw.length > 24 ? `${raw.slice(0, 21)}…` : raw;
  return `<span class="rl-expr" title="${escapeHtml(short)}">…</span>`;
}

function componentJsxRoot(source: ts.SourceFile, componentName?: string): ts.Node | null {
  let fallback: ts.Node | null = null;
  let named: ts.Node | null = null;

  const captureReturn = (body: ts.Node): ts.Node | null => {
    let found: ts.Node | null = null;
    const visit = (node: ts.Node) => {
      if (found) return;
      if (ts.isReturnStatement(node) && node.expression) {
        const expression = ts.isParenthesizedExpression(node.expression)
          ? node.expression.expression
          : node.expression;
        if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
          found = expression;
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
    return found;
  };

  const inspect = (name: string | undefined, body: ts.Node | undefined) => {
    if (!body) return;
    const root = ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body) || ts.isJsxFragment(body)
      ? body
      : ts.isParenthesizedExpression(body)
        ? captureReturn(body) ?? (ts.isJsxElement(body.expression) || ts.isJsxSelfClosingElement(body.expression) || ts.isJsxFragment(body.expression) ? body.expression : null)
        : captureReturn(body);
    if (!root) return;
    if (name && name === componentName) named = root;
    if (!fallback) fallback = root;
  };

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node)) inspect(node.name?.text, node.body);
    else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      inspect(node.name.text, node.initializer.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return named ?? fallback;
}

/**
 * Reconstructs a script-free wireframe HTML fragment from a JSX component's
 * source. Static structure, text, and class names are preserved; every
 * dynamic expression is replaced with a neutral placeholder.
 */
export function renderJsxWireframe(
  source: string,
  filePath: string,
  componentName?: string,
): string | null {
  const scriptKind = filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : filePath.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : filePath.endsWith(".ts")
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JSX;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const root = componentJsxRoot(sourceFile, componentName);
  if (!root) return null;
  const budget: WireframeBudget = { nodes: MAX_WIREFRAME_NODES };
  const fragment = renderJsxChild(root, sourceFile, budget, 0);
  return fragment.trim() ? fragment : null;
}
