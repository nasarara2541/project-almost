# RepoLens three-minute demo script

## Before recording

1. Run `npm install`.
2. Optionally set `OPENAI_API_KEY` in `.env.local`. Without it the trace
   panel uses the deterministic local analyzer and shows a “Local analysis”
   badge — never claim model output without a working key.
3. Run `npm test`, then `npm run dev`.
4. Open `http://localhost:3000` at a laptop-sized viewport.
5. Leave the prefilled Northstar repository URL unchanged.

## 0:00–0:25 — The problem

Show the hero: “What does this repo look like — and which code makes it?”

> “When you open an unfamiliar repository you can read the code, but you
> can't see the product. RepoLens is a GitHub-to-interface visualizer: it
> reconstructs the interface a repository contains — safely, without
> executing any of its code — and connects every screen back to the source.”

## 0:25–1:05 — Overview + interface gallery

Click **Analyze Repository**. Walk through the repository overview: project
type, frameworks, package manager, language breakdown, folder structure,
entry points.

Scroll to the **Interface preview** gallery:

> “These previews are reconstructed statically from the source: HTML pages
> are sanitized, JSX components become wireframes, and everything renders in
> a fully sandboxed frame. Scripts never run.”

Point at the screens row (homepage, `/settings`) and the components row with
role badges (layout, card, control).

## 1:05–1:45 — Code connection

Click the `SettingsPage` card. Show the **Code connection** panel: source
file, symbol, line range, imports, dependents — and the highlighted node in
the architecture graph below.

> “Every visual element links to the file and function that create it, and
> to its place in the dependency graph.”

## 1:45–2:20 — Ask questions

In the trace panel ask: “How does the settings page work?”

> “Answers are grounded: every step cites a real file and symbol, and
> citations are validated against the repository before they're shown. With
> no API key configured this is the deterministic local analyzer — clearly
> labeled. With OPENAI_API_KEY set, the model provider takes over with the
> same validation.”

Click a step to jump the graph highlight.

## 2:20–2:50 — It works for any repository

Mention (or show with a second URL) the other repository classes:

> “A Chrome extension shows its popup interface and controls. A monorepo
> gets a project picker. And a Python CLI or backend repo doesn't fail — it
> shows the project type, structure, and architecture with a clear ‘no
> visual interface’ message.”

## 2:50–3:00 — Close

Show the optional live execution preview section at the bottom.

> “For runnable frontend projects, a live WebContainers preview is available
> as an optional enhancement — but the product never depends on executing
> unknown code. RepoLens: see the interface inside any repository.”
