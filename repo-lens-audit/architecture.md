# Architecture

```text
GitHub URL
  → normalization and metadata
  → bounded tree and source acquisition
  → project and interface detection
  → JavaScript/TypeScript relationship graph
  → deterministic repository audit
  → evidence, coverage, opportunities, and static interface report
  → in-memory analysis session with automatic cleanup
```

Core boundaries:

- GitHub acquisition rejects unsafe paths and secrets and discloses skipped
  files.
- The audit reads only fetched repository files.
- The interface renderer sanitizes source and disables scripts.
- Feature tracing may use an optional model, but its citations are validated
  against the analysis.
- Target repository code is never executed.
