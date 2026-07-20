# RepoLens implementation audit — repository-audit pivot

This document describes the current product contract and the checks used to
verify it before release.

## Product contract

RepoLens is a read-only repository audit and contribution finder. It must:

- Produce useful core results without executing repository code.
- Produce deterministic core findings without requiring an AI key.
- Cite exact evidence for every finding.
- Distinguish facts from heuristics with confidence and limitation labels.
- Continue with partial analysis when individual files are oversized or fail
  to fetch, while disclosing the missing coverage.
- Turn reliable findings into concrete contribution tasks.
- Name possibly unreferenced files without claiming they are proven dead.

## Implemented audit areas

- Community health files.
- Setup documentation and package scripts.
- Environment examples and Node.js version declarations.
- Tests and GitHub Actions test execution.
- Large and skipped source files.
- TODO/FIXME/HACK markers.
- High static fan-in.
- Possibly unreferenced source files with framework/convention exclusions.
- Literal image elements missing `alt` attributes.
- Coverage, unsupported-file, and static-analysis limitations.

## Reliability safeguards

- Missing-file claims are based on the complete fetched inventory.
- Source signals include exact line locations where available.
- Partial coverage lowers confidence for absence-based test findings.
- Dead-code candidates exclude entry points, detected routes, tests,
  configuration, stories, scripts, migrations, declarations, and known
  framework entry conventions.
- `@/`, `~/`, and `$lib/` local aliases are resolved when their target is
  unambiguous.
- Zero static fan-in is always labeled “possibly unreferenced.”
- Runtime behavior, dynamic imports, dependency injection, and external
  consumers remain explicit limitations.

## Release verification

Run:

```bash
npm test
npm run health
npm run build
```

Then verify the complete browser flow using:

1. The bundled Vite fixture.
2. A public frontend repository with tests and CI.
3. A repository missing community documentation.
4. A Chrome extension.
5. A non-visual library or backend.
6. A repository containing oversized supported files.

The release should not contain WebContainer code, live-preview endpoints, or
the `@webcontainer/api` dependency.
