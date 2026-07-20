# Product requirements

## Primary users

- Maintainers auditing their own open-source repository.
- Contributors looking for useful, evidence-backed work.
- Developers onboarding to an unfamiliar codebase.

## Required experience

After entering a public GitHub URL, a user can:

1. Understand the project and analysis coverage.
2. See prioritized gaps with exact evidence and limitations.
3. Copy a concrete contribution task.
4. Inspect named possibly unreferenced files.
5. Search source relationships and supporting interface evidence.
6. Export the audit as Markdown.

## Reliability requirements

- Core findings are deterministic.
- Every finding has evidence and confidence.
- Partial analysis is disclosed.
- Static signals are not represented as runtime facts.
- Zero inbound references are not represented as proven dead code.
- Repository code is never executed.
