# RepoLens

RepoLens is an evidence-backed **open-source contribution finder**. Tell it
your experience, available time, and preferred type of work, then paste a
GitHub repository. RepoLens returns three contribution matches with exact
evidence, confidence, limitations, and a ready-to-use GitHub issue.

RepoLens reads supported source and repository files without executing the
project. Its core audit is deterministic and does not require an AI key.

## What RepoLens reports

- Contribution matches ranked by experience, available time, and work type.
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
- GitHub login, installed private-repository analysis, saved reports, rescan
  history, and contributor outcome/false-positive feedback.
- Pull-request verification that reruns the original finding on the exact PR
  commit and reports CI, trusted maintainer reviews, new high-priority
  findings, and merge status separately.

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

RepoLens does not label a contribution vaguely as “good.” A linked pull
request progresses through evidence-backed states: PR linked, change detected,
evidence verified, maintainer approved, and merged. “Evidence verified” means
the original finding is gone on the exact PR commit, analysis coverage is
complete, CI is passing, and no new high-priority finding appeared. Maintainer
approval and merge acceptance remain separate GitHub decisions.

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
Anonymous public analysis works without account configuration.

### GitHub accounts and private repositories

Create a GitHub App and configure:

- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:3000/api/auth/github/callback`
- Repository permission: **Contents — Read-only**
- Repository permission: **Pull requests — Read-only**
- Repository permission: **Checks — Read-only**
- Repository permission: **Commit statuses — Read-only**
- Repository metadata: **Read-only** (included by GitHub)
- Enable **Request user authorization (OAuth) during installation**

Copy `.env.example` to `.env.local`, add the GitHub App client ID and client
secret, and generate a strong session-encryption secret:

```bash
openssl rand -base64 32
```

Set the output as `AUTH_SECRET`. Users can then install RepoLens on selected
repositories. GitHub App permissions restrict its user token to read-only
repository evidence for repositories where the app is installed. If these
permissions are added to an existing app, GitHub may ask installations to
approve the new permissions.

### Pull request verification webhooks

Manual “Verify again” works without webhooks. To notify RepoLens when tracked
PR evidence changes, set a strong `GITHUB_WEBHOOK_SECRET`, configure the same
secret in the GitHub App, and set its webhook URL to:

```text
https://your-repolens-domain.example/api/github/webhook
```

Subscribe to **Pull request**, **Pull request review**, and **Check run**
events. GitHub cannot deliver webhooks directly to `localhost`; use a secure
development tunnel when testing local deliveries. Webhooks are signature
verified and only mark matching records for refresh—the longer read-only
analysis runs when the user opens the result or selects “Update verification.”

### Saved analyses and feedback

Local development automatically uses `.data/repolens.db`. For a hosted,
multi-instance deployment, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to
use a shared libSQL/Turso database. Database tables are created automatically.

Optional environment variables in `.env.local`:

- `GITHUB_TOKEN` — raises GitHub REST API rate limits.
- `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, and `AUTH_SECRET` — enable
  GitHub login, installed private repositories, saved analyses, and feedback.
- `GITHUB_WEBHOOK_SECRET` — verifies GitHub webhook deliveries for tracked
  pull requests.
- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` — optional hosted persistence;
  local development uses a private SQLite file by default.
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

- Public `github.com` repositories anonymously; installed private repositories
  after GitHub authorization.
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

Source workspaces remain temporary and are deleted after the bounded analysis
session. Signed-in report results, rescan lineage, and contributor feedback are
stored durably. Private GitHub tokens are encrypted at rest and browser cookies
contain only opaque, hashed-on-storage session identifiers.
