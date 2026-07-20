# RepoLens

RepoLens is an evidence-backed **repository audit and contribution finder**.
Paste a public GitHub repository and get a prioritized explanation of what is
healthy, what deserves attention, and what useful contribution someone could
make next.

RepoLens reads supported source and repository files without executing the
project. Its core audit is deterministic and does not require an AI key.

## What RepoLens reports

- A transparent repository-readiness score with per-category breakdowns.
- Prioritized gaps across community health, developer experience, tests and
  CI, maintainability, and frontend quality.
- Evidence for every finding, including exact files and line numbers when
  available.
- Confidence, limitations, impact, and contribution difficulty.
- Copyable contribution tasks derived from verified findings.
- Named files with zero detected static inbound references, carefully labeled
  as **possibly unreferenced** rather than confirmed dead code.
- Analysis coverage, skipped files, unsupported files, and static-analysis
  limitations.
- A searchable source explorer, architecture map, grounded feature tracing,
  and safe static interface reconstruction.
- Downloadable Markdown audit reports.

## Audit categories

### Community readiness

README, license, contribution guide, code of conduct, security policy, issue
templates, and pull-request templates.

### Developer experience

Setup documentation, conventional package scripts, environment examples, and
runtime-version declarations.

### Testing and automation

Test files, a predictable test command, GitHub Actions, and whether workflows
appear to run the available test suite.

### Maintainability

Large source files, oversized skipped files, TODO/FIXME/HACK markers, high
static fan-in, and possibly unreferenced files.

### Frontend quality

Literal image elements missing `alt` attributes, plus routes, screens,
components, styles, and safe static interface previews.

## Reliability model

RepoLens distinguishes facts from signals:

- File-presence checks and exact source matches are high-confidence evidence.
- Heuristics carry explicit confidence and limitation notes.
- Partial coverage lowers confidence where missing files could change a result.
- Zero static fan-in is never described as proof of dead code. Entry points,
  routes, tests, configuration, scripts, migrations, stories, and known
  framework-convention files are excluded from that check.
- Runtime behavior, dependency injection, external consumers, and dynamically
  constructed imports may not be visible to static analysis.
- Core findings do not depend on a language model.

## Safe static interface reconstruction

For frontend repositories, RepoLens reconstructs interface previews from HTML
and component source without executing repository code:

- HTML is sanitized to remove scripts, handlers, active embeds, unsafe URLs,
  and form actions.
- JSX is converted into a structural wireframe.
- Vue, Svelte, and Astro templates are sanitized similarly.
- Previews render inside script-disabled sandboxed iframes.

These are source-grounded structural previews, not runtime screenshots.

## Setup

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Next.js and paste any public GitHub repository.

Optional environment variables in `.env.local`:

- `GITHUB_TOKEN` — raises GitHub REST API rate limits.
- `OPENAI_API_KEY` — optionally enriches feature tracing. It is not used for
  the core audit.
- `OPENAI_TRACE_MODEL` and `OPENAI_API_BASE_URL` — override the optional trace
  model and endpoint.
- `ANALYSIS_TTL_MS` — controls in-memory analysis retention, capped at 30
  minutes.

## Verification

```bash
npm test
npm run health
npm run build
```

## Repository limits

- Public `github.com` repositories only.
- Up to 2,000 supported fetched files.
- Up to 20 MB total supported content.
- Individual files over 512 KB are skipped and disclosed in coverage instead
  of failing the entire repository.
- Environment files are never fetched except `.env.example`.
- Unsupported and skipped content is reported so users can judge completeness.

## Current scope

JavaScript and TypeScript repositories receive the deepest source-relationship
analysis. RepoLens still provides project classification, community checks,
coverage, structure, and selected ecosystem signals for supported Python, Go,
Rust, Ruby, PHP, Java, Kotlin, Swift, C/C++, C#, shell, Vue, Svelte, and Astro
files.

Analysis sessions currently live in process memory and temporary storage. A
multi-instance public deployment should add shared caching or reproducible
analysis by repository commit SHA before treating analysis IDs as shareable.
