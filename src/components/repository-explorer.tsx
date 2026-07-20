"use client";

import { useMemo, useState } from "react";
import type { AnalyzeResult, AnalyzedSourceFile } from "@/types/api";

const kindLabels: Record<AnalyzedSourceFile["kind"], string> = {
  entry: "Entry point",
  component: "Component",
  service: "Service",
  source: "Source",
};

export function RepositoryExplorer({ analysis }: { analysis: AnalyzeResult }) {
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState(analysis.files[0]?.path ?? "");
  const files = useMemo(() => {
    const target = query.trim().toLowerCase();
    return target
      ? analysis.files.filter((file) => [file.path, file.kind, ...file.components, ...file.serviceFunctions].join(" ").toLowerCase().includes(target))
      : analysis.files;
  }, [analysis.files, query]);
  const selected = analysis.files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

  return (
    <section className="repository-explorer" aria-labelledby="repository-explorer-heading">
      <div className="results-section-heading">
        <span className="step-number">04</span>
        <div>
          <p className="section-label">Repository explorer</p>
          <h2 id="repository-explorer-heading">Inspect the source behind the audit</h2>
          <p>Search parsed source files and review their detected imports, dependents, components, and services.</p>
        </div>
      </div>
      <div className="file-explorer">
        <div className="file-explorer__list">
          <label><span>Search source files</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="File or symbol name" /></label>
          <span>{files.length} of {analysis.files.length} parsed files</span>
          <ul>
            {files.map((file) => (
              <li key={file.path}>
                <button type="button" className={selected?.path === file.path ? "is-selected" : ""} onClick={() => setSelectedPath(file.path)}>
                  <strong>{file.path}</strong><small>{kindLabels[file.kind]} · {file.dependents.length} inbound</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="file-explorer__detail">
          {selected ? (
            <>
              <div><span>{kindLabels[selected.kind]}</span><h3>{selected.path}</h3></div>
              <dl>
                <div><dt>Inbound references</dt><dd>{selected.dependents.length}</dd></div>
                <div><dt>Local imports</dt><dd>{selected.imports.length}</dd></div>
                <div><dt>Components</dt><dd>{selected.components.length}</dd></div>
                <div><dt>Services</dt><dd>{selected.serviceFunctions.length}</dd></div>
              </dl>
              <div className="file-relationships">
                <div><strong>Imported files</strong>{selected.imports.length ? <ul>{selected.imports.map((file) => <li key={file}><code>{file}</code></li>)}</ul> : <p>None detected</p>}</div>
                <div><strong>Used by</strong>{selected.dependents.length ? <ul>{selected.dependents.map((file) => <li key={file}><code>{file}</code></li>)}</ul> : <p>No static inbound references detected</p>}</div>
                <div><strong>Components</strong>{selected.components.length ? <ul>{selected.components.map((name) => <li key={name}><code>{name}</code></li>)}</ul> : <p>None detected</p>}</div>
                <div><strong>Service functions</strong>{selected.serviceFunctions.length ? <ul>{selected.serviceFunctions.map((name) => <li key={name}><code>{name}</code></li>)}</ul> : <p>None detected</p>}</div>
              </div>
            </>
          ) : <div className="empty-filter-state"><strong>No source file matches.</strong></div>}
        </div>
      </div>
    </section>
  );
}
