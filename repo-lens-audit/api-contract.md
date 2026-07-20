# API contract

## `POST /api/analyze`

Request:

```json
{ "repoUrl": "https://github.com/owner/repository" }
```

The response includes:

- `analysisId`, normalized repository information, and detected project type.
- Parsed files, routes, interfaces, and architecture graph.
- `audit.score`, status, category scores, findings, strengths, opportunities,
  and analysis coverage.
- Every finding includes confidence, severity, evidence, files, a
  recommendation, a contribution task, and any reliability limitation.

Important statuses:

- `400` invalid request or URL.
- `404` public repository not found.
- `422` repository cannot be safely or completely acquired within hard limits.
- `429` GitHub API rate limit reached.

## `DELETE /api/analyze/:id`

Deletes the temporary analysis and fetched workspace.

## `POST /api/trace`

Request:

```json
{ "analysisId": "...", "question": "Which code creates the settings page?" }
```

Returns a local or optional model-assisted feature trace whose file and symbol
citations have been validated against the analysis.
