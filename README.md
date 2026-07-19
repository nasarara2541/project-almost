# RepoLens

Paste a public GitHub repository and RepoLens maps its architecture, runs it live inside your own browser tab, and explains how the visible product connects to the underlying code.

Three layers, connected:

```
What the user sees  ->  How the product works  ->  Where it lives in the code
```

## How it works

1. **Analyze.** Paste any public `https://github.com/owner/repository` URL. The server fetches the repository read-only (metadata, tree, manifests, source, and the text/assets needed to run it), classifies the project, detects monorepo subprojects and runnable roots, and builds a dependency/architecture graph. Nothing is executed on the server.
2. **Preview in your browser.** For runnable React, Next.js, or Vite projects, the server returns a file bundle and the browser boots a sandboxed Node.js runtime (WebContainers, the technology behind StackBlitz), runs `npm install` and the project's dev script entirely client-side, and streams the running app into an iframe. No server process, no shared infrastructure executing untrusted code — which is why arbitrary public repositories are allowed.
3. **Trace.** Ask a plain-English question ("where does the settings page come from?"). Relevant source context is sent to the model with a strict JSON schema requiring real file names, line numbers, and function names; every citation is validated against the actual repository before it is shown, and the matching node is highlighted in the architecture graph.

## Project detection

The analyzer classifies repositories as: frontend apps (React, Vite, Next.js, and other detected frameworks such as Vue, Svelte, Astro, Angular, Nuxt), monorepos with runnable subdirectories, Chrome extensions (via `manifest.json` with a `manifest_version`), Python projects (via `pyproject.toml`, `requirements.txt`, `setup.py`, etc.), Node CLI tools (via a `bin` entry), and libraries (published entry points without app scripts).

Analysis and preview are independent statuses. Every repository gets **Analysis available**; runnable React/Next/Vite projects additionally get **Live preview available**; other types show **Live preview unsupported** with a specific reason (e.g. Chrome extensions must load into a browser's extension system; the in-browser sandbox runs Node.js, not Python). Preview boot failures surface as **Live preview failed** with the live npm install/dev log.

## Sandboxing model

Live previews use WebContainers rather than a server-side sandbox (Docker/E2B/etc.). Repository code executes only inside the visitor's own cross-origin-isolated browser tab, which removes the server-side untrusted-code problem entirely and works within Vercel's serverless model — the server's only job is fetching and packaging source files. `next.config.ts` sets the required `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` headers; without them the runtime silently fails to boot. Use a Chromium-based browser for previews.

Bundled demo fixtures (instant, offline):

- `https://github.com/repolens-demo/northstar-console` — bundled demo fixture with routes, components, preference storage, and a deployment interaction.
- `https://github.com/digitalocean/sample-vite-react` — local snapshot pinned to commit `ce1b05ce493249f241bceee9ea30513b88697cc0` (see `fixtures/verified/manifest.json`).

## Setup

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Environment variables (`.env.local` locally, project settings on Vercel):

- `LLAMA_API_KEY` — required for feature tracing. Uses the Llama API's OpenAI-compatible endpoint.
- `LLAMA_TRACE_MODEL` — optional, defaults to `Llama-4-Maverick-17B-128E-Instruct-FP8`.
- `LLAMA_API_BASE_URL` — optional, defaults to `https://api.llama.com/compat/v1`.
- `GITHUB_TOKEN` — optional but recommended; raises GitHub REST API rate limits for repository fetching.

Run the test suite (43 tests) with `npm test`, or the end-to-end health check with `npm run health`.

## Limits

Public repositories only. Fetching is bounded (2,000 supported files, 512 KB per text file, 20 MB total; small binary assets are best-effort). Preview bundles are capped at 2,000 files / 15 MB. Environment files (`.env*`) are never fetched or shipped to the browser except `.env.example`. Previews are JavaScript/TypeScript projects that run with `npm install` plus a `dev`/`start`/`serve`/`preview` script.
