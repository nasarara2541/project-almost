# RepoLens

RepoLens is a **GitHub-to-interface visualizer**. Paste any public GitHub
repository URL and RepoLens answers: *what does this project look like, what
interface does it contain, and how is that interface connected to the code?*

It does not need to run the repository. The interface preview is
reconstructed **statically and safely from source** — no repository code is
ever executed by default.

```
GitHub URL
  → fetch & analyze repository (read-only)
  → detect project type and visual interface
  → extract screens, pages, popups, routes, components, styles, assets
  → render a safe visual preview gallery
  → connect every screen/component to its source files
  → show the architecture graph
  → answer questions grounded in the real code
```

## What you get for different repositories

- **Frontend websites** (React, Next.js, Vite, Vue, Svelte, Astro, Angular,
  Nuxt): homepage and route screens, components with inferred visual roles
  (navigation, card, table, form, modal, …), CSS/Tailwind detection, images
  and other assets.
- **Chrome extensions**: the `popup.html` interface rendered as a sanitized
  preview, detected popup buttons/inputs/links, extension icons, options
  page, and content-script surfaces — each connected to its source files.
- **Frontend monorepos**: every package is detected (e.g. a Vite app and a
  Next.js app side by side) and the gallery has a project picker to choose
  which interface to explore.
- **CLI, backend, library, or data repositories**: analysis never fails.
  You get the project type, technologies, language breakdown, folder
  structure, entry points, and the architecture map, plus the message
  *“No visual interface detected. This repository appears to be a CLI,
  library, backend, or data project.”*

## How the safe preview works

- Real HTML pages (including extension popups) are **sanitized**: scripts,
  iframes/objects/embeds, event handlers, `javascript:` URLs, and form
  actions are stripped; local stylesheets are inlined (with remote
  `@import`/`url()` references removed); local images become data URIs and
  external images become neutral placeholders.
- JSX components are converted into **wireframes** by walking the AST:
  static structure, text, and class names are kept; dynamic expressions
  become placeholders; child components render as labeled blocks; `map`
  callbacks and conditionals render their primary branch.
- Vue templates, Svelte markup, and Astro templates are sanitized the same
  way (framework directives removed).
- Every preview renders in `<iframe sandbox="" srcDoc>` — the empty
  `sandbox` attribute disables script execution at the browser level, so
  even a sanitizer escape cannot run code.

## Code connection, architecture, and tracing

Click any gallery card to see its **code connection**: source file, symbol,
line numbers, imports, dependents, referenced styles and assets, and the
matching node highlighted in the architecture graph (routes → components →
services → files, with fan-in/risk highlighting).

Ask questions like “How does the settings page work?” or “Which files
control dark mode?” in the trace panel. Answers cite only files and symbols
that exist in the analyzed repository — citations are validated before they
are shown and invalid ones are rejected.

### Trace providers

- **Deterministic local analyzer (default)** — no API key required. Results
  are labeled *Local analysis* and never presented as model output.
- **OpenAI (optional)** — set `OPENAI_API_KEY` to route trace questions
  through an OpenAI model (`OPENAI_TRACE_MODEL`, default `gpt-5.6`;
  `OPENAI_API_BASE_URL` supports any OpenAI-compatible endpoint). The same
  citation validation applies to model output.

## Optional live execution preview

For runnable React/Next.js/Vite projects, an optional *live execution
preview* can boot the actual app inside a sandboxed in-browser Node.js
runtime (WebContainers) in the visitor's own tab. This is an enhancement,
not the product's core — analysis and the interface gallery work for every
repository without executing anything. `next.config.ts` sets the
cross-origin-isolation headers WebContainers requires.

## Setup

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Environment variables (all optional, `.env.local` locally):

- `GITHUB_TOKEN` — raises GitHub REST API rate limits for repository fetching.
- `OPENAI_API_KEY` — enables the optional OpenAI trace provider.
- `OPENAI_TRACE_MODEL`, `OPENAI_API_BASE_URL` — override model/endpoint.

Run the test suite with `npm test` (75 tests), or the end-to-end health
check with `npm run health`.

## Repository input

Any public `github.com` repository URL works. `http://` and `https://`,
`www.`, missing schemes, trailing slashes, `.git` suffixes, and deep links
such as `/tree/<branch>` or `/blob/<path>` are all normalized to the
repository root. Private, missing, oversized, or truncated repositories
produce specific error messages.

Bundled demo fixtures (instant, offline):

- `https://github.com/repolens-demo/northstar-console` — Vite dashboard demo.
- `https://github.com/digitalocean/sample-vite-react` — pinned local snapshot.
- `fixtures/chrome-extension-demo/` — Chrome extension fixture used by the
  interface-detection tests.

## Limits

Public repositories only. Fetching is bounded (2,000 supported files,
512 KB per text file, 20 MB total; small binary assets best-effort).
`.env*` files are never fetched (except `.env.example`). Wireframes show
the primary branch of conditional UI and cannot execute runtime logic —
they are structural previews, not pixel-perfect renders. Tailwind class
styling is detected but not compiled into wireframes.
