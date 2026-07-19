# RepoLens audit — 2026-07-19

Audit of the implementation on `main` (commit `6760a27`) against the intended
product: a GitHub-to-interface visualizer that safely reconstructs a visual
preview of a repository's interface from source, without executing it.

## What actually works (verified, not from status reports)

- `POST /api/analyze` and `POST /api/trace` are **real**, not placeholders.
- Generic public-repository fetching works: GitHub metadata + Git Trees +
  raw file download, with URL normalization, private/404/rate-limit/too-large
  error codes, `.env` exclusion, and path-traversal checks
  (`src/lib/analyzer/github-source.ts`).
- Project detection works: frameworks, package managers, monorepo/workspace
  detection, Chrome-extension/Python/CLI/library classification
  (`src/lib/analyzer/project-detector.ts`).
- Source analysis works for JS/TS: imports, React components, service
  functions, entry points, routes, dependency graph with fan-in/risk
  (`src/lib/analyzer/parser.ts`, `repository-analyzer.ts`).
- Trace citation validation works: unknown files/symbols are rejected and
  citations are canonicalized to real locations (`src/lib/trace/trace-result.ts`).
- Analysis sessions with TTL + cleanup work.
- Production build passes. Tests: **44 of 45 pass**.

## Failures found

1. **Test failure**: `tests/analyzer/analyzer.test.ts` expects
   `.eslintrc.cjs` in the DigitalOcean fixture; the file is missing from
   `fixtures/verified/digitalocean-sample-vite-react/`. Fixture drift.
2. **Live-testing the three target repositories** (Jugaadu-Flex-2,
   code-review-graph, shadcn-dashboard-landing-template) is blocked in this
   sandbox: outbound GitHub API access is restricted to the session's own
   repository (requests return "GitHub access to this repository is not
   enabled for this session"). Equivalent repository shapes are therefore
   exercised through local fixtures and mocked GitHub responses.

## Product mismatches vs. the intended product

1. **Live preview is the center of the product.** The hero says "Run any
   public React, Next.js, or Vite repo in your browser"; the main workspace
   panel is a WebContainers live-preview session. The intended center — a
   safe, static interface gallery reconstructed from source — does not exist.
2. **No interface detection at all.** Nothing detects HTML pages,
   Vue/Svelte/Astro components, CSS/Tailwind usage, images/icons, Chrome
   extension popup files, or component visual roles. `.vue`/`.svelte`/
   `.astro`/`.html`/`.css` files are fetched but never analyzed.
3. **No interface preview/gallery.** There are no preview cards, no safe
   rendered previews, and no click-through from a screen/component to its
   source, styles, and assets.
4. **Chrome extensions are dead ends.** A Chrome extension (e.g.
   Jugaadu-Flex-2) is classified correctly, then the UI only says "Live
   preview unsupported". The popup interface, controls, and icons are never
   shown.
5. **CLI/backend/library/data repos degrade poorly.** A Python repo (e.g.
   code-review-graph) produces an empty graph and no folder structure,
   entry-point, or "No visual interface detected" messaging.
6. **Trace provider is the Llama API, and there is no local fallback.**
   The spec wants an optional OpenAI (GPT-5.6) provider keyed on
   `OPENAI_API_KEY`, with a deterministic local analyzer (clearly labeled as
   local) when the key is missing. Today a missing `LLAMA_API_KEY` makes
   tracing fail with HTTP 503.
7. **URL normalization is too strict.** `http://github.com/...` and common
   forms like `.../tree/main` are rejected; the spec says to normalize them.
8. **Repository overview is thin.** No project name/description display, no
   language breakdown, no entry points, no important files, no folder
   structure.
9. **Default input is a fake URL** (`https://github.com/repolens-demo/
   northstar-console`), which reads as if arbitrary URLs are not supported.
10. **README/DEMO describe the old live-runner product.**

## Fix plan

- Add an interface-detection pass (screens, components + visual roles,
  styles/Tailwind, assets, Chrome-extension popup/options) and a safe static
  preview generator (sanitized HTML for real pages, JSX-derived wireframes
  for components) rendered in fully sandboxed `<iframe sandbox srcDoc>` —
  no repository code executes anywhere by default.
- Extend analysis with language breakdown, folder structure, and important
  files; never fail on non-frontend repos and show the explicit
  "No visual interface detected…" state.
- Rebuild the UI around: overview → interface gallery (with monorepo
  project picker) → code connection → architecture graph → trace. Keep the
  WebContainers live preview as an optional enhancement.
- Replace the Llama provider with an optional OpenAI provider plus a
  deterministic local trace fallback; keep citation validation for both.
- Widen URL normalization; fix the fixture test; add tests for interface
  detection, preview sanitization, and trace fallback; update docs.
