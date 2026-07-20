# RepoLens three-minute demo

## Before recording

1. Run `npm install`, `npm test`, and `npm run dev`.
2. Open the local URL at a laptop-sized viewport.
3. Keep the prefilled demo repository for a fast, offline analysis.

## 0:00–0:25 — The problem

Show the hero: “What should we improve in this repository?”

> “Open-source repositories contain useful work, but contributors often do
> not know where to start and maintainers do not have time to audit every
> gap. RepoLens turns repository evidence into prioritized, contribution-ready
> tasks without executing unknown code.”

## 0:25–1:05 — Start here

Click **Analyze Repository**. Show:

- Overall readiness and category scores.
- High-priority and actionable finding counts.
- Supported-file coverage.
- The coverage disclosure and explicit limitations.

> “The score is transparent: every deduction is represented by a finding
> below. RepoLens also tells us exactly what it could and could not inspect.”

## 1:05–1:45 — Evidence-backed gaps

Open a finding and point out:

- Severity and confidence.
- Why it matters.
- Exact files and line references.
- Reliability note.
- Recommended action and copyable contribution task.

Open **possibly unreferenced files** when present:

> “RepoLens names files with no detected static inbound references, while
> clearly warning that framework conventions and runtime loading must be
> checked before removal.”

## 1:45–2:15 — Contribution finder

Show the opportunity cards and copy one task.

> “These are not generic project ideas. Every task traces back to an audit
> finding and repository evidence.”

## 2:15–2:40 — Repository explorer

Search for a file, select it, and show imports, dependents, components, and
services. Then briefly show the architecture graph and grounded trace.

## 2:40–2:55 — Interface evidence

Show the static interface gallery.

> “For frontend projects, source is reconstructed into script-disabled
> structural previews. This is evidence for navigation—not a promise that an
> arbitrary application can run without its backend or secrets.”

## 2:55–3:00 — Close

Download the Markdown report.

> “RepoLens helps maintainers see their gaps and helps contributors choose
> useful work they can verify.”
