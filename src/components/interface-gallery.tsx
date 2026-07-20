"use client";

import { useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import type {
  AnalyzeResult,
  CodeLocation,
  InterfaceComponent,
  InterfaceScreen,
} from "@/types/api";

/**
 * The interface gallery: safe static previews of every detected screen and
 * component, reconstructed from repository source. Previews render in fully
 * sandboxed iframes (`sandbox=""`, so scripts are disabled by the browser), so
 * no repository code ever executes.
 */

type GalleryItem = {
  id: string;
  graphNodeId: string | null;
  name: string;
  kindLabel: string;
  route?: string;
  file: string;
  location: CodeLocation;
  previewHtml: string | null;
  styles: string[];
  assets: string[];
  controls: string[];
  componentNames: string[];
  subprojectRoot: string;
};

type InterfaceGalleryProps = {
  analysis: AnalyzeResult;
  selectedItemId: string | null;
  onSelectItem: (itemId: string, graphNodeId: string | null) => void;
};

function screenToItem(screen: InterfaceScreen): GalleryItem {
  const kindLabels: Record<InterfaceScreen["kind"], string> = {
    page: "HTML page",
    route: "Route",
    popup: "Extension popup",
    options: "Extension options",
    component: "Component",
    "content-script": "Content script",
  };
  return {
    id: screen.id,
    graphNodeId:
      screen.kind === "route" && screen.route ? `route:${screen.route}:${screen.file}` : null,
    name: screen.name,
    kindLabel: kindLabels[screen.kind],
    route: screen.route,
    file: screen.file,
    location: screen.location,
    previewHtml: screen.previewHtml,
    styles: screen.styles,
    assets: screen.assets,
    controls: screen.controls,
    componentNames: screen.componentNames,
    subprojectRoot: screen.subprojectRoot,
  };
}

function componentToItem(component: InterfaceComponent): GalleryItem {
  return {
    id: `component-card:${component.file}#${component.name}`,
    graphNodeId: `component:${component.file}#${component.name}`,
    name: component.name,
    kindLabel: component.role,
    file: component.file,
    location: component.location,
    previewHtml: component.previewHtml,
    styles: [],
    assets: [],
    controls: [],
    componentNames: [],
    subprojectRoot: component.subprojectRoot,
  };
}

export function InterfaceGallery({ analysis, selectedItemId, onSelectItem }: InterfaceGalleryProps) {
  const report = analysis.interface;
  const [subproject, setSubproject] = useState<string>("all");
  const [showAllComponents, setShowAllComponents] = useState(false);

  const subprojectRoots = useMemo(() => {
    const roots = new Set<string>([
      ...report.screens.map((screen) => screen.subprojectRoot),
      ...report.components.map((component) => component.subprojectRoot),
    ]);
    return [...roots].sort();
  }, [report]);

  const screens = report.screens
    .filter((screen) => subproject === "all" || screen.subprojectRoot === subproject)
    .map(screenToItem);
  const allComponents = report.components
    .filter((component) => subproject === "all" || component.subprojectRoot === subproject)
    .map(componentToItem);
  const components = showAllComponents ? allComponents : allComponents.slice(0, 12);

  const selected =
    [...screens, ...allComponents].find((item) => item.id === selectedItemId) ?? null;
  const selectedFile = selected
    ? analysis.files.find((file) => file.path === selected.file) ?? null
    : null;

  if (!report.hasVisualInterface) {
    return (
      <section className="interface-gallery" aria-labelledby="interface-heading">
        <div className="interface-gallery__heading">
          <span className="step-number">02</span>
          <div>
            <p className="section-label">Interface</p>
            <h2 id="interface-heading">Interface preview</h2>
          </div>
        </div>
        <div className="no-interface" role="status">
          <strong>No visual interface detected.</strong>
          <p>
            {report.message ??
              "This repository appears to be a CLI, library, backend, or data project."}
          </p>
          <p>
            The project overview, folder structure, architecture map, and feature tracing below
            still describe how the code is organized.
          </p>
        </div>
      </section>
    );
  }

  const renderCard = (item: GalleryItem) => (
    <button
      key={item.id}
      type="button"
      className={`gallery-card ${selectedItemId === item.id ? "gallery-card--selected" : ""}`}
      onClick={() => onSelectItem(item.id, item.graphNodeId)}
      aria-pressed={selectedItemId === item.id}
    >
      <span className="gallery-card__frame" aria-hidden="true">
        {item.previewHtml ? (
          <iframe
            sandbox=""
            srcDoc={item.previewHtml}
            title={`Preview of ${item.name}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            tabIndex={-1}
          />
        ) : (
          <span className="gallery-card__placeholder">No static preview, source only</span>
        )}
      </span>
      <span className="gallery-card__meta">
        <strong>{item.name}</strong>
        <span className="gallery-card__kind">{item.kindLabel}</span>
        <code>{item.route ?? item.file}</code>
      </span>
    </button>
  );

  return (
    <section className="interface-gallery" aria-labelledby="interface-heading">
      <div className="interface-gallery__heading">
        <span className="step-number">02</span>
        <div>
          <p className="section-label">Interface</p>
          <h2 id="interface-heading">Interface preview</h2>
          <p className="interface-gallery__summary">{report.summary} Previews are reconstructed
            statically from source and rendered without executing any repository code.</p>
        </div>
        {subprojectRoots.length > 1 ? (
          <label className="subproject-picker">
            Project
            <select value={subproject} onChange={(event) => setSubproject(event.target.value)}>
              <option value="all">All projects</option>
              {subprojectRoots.map((root) => (
                <option key={root} value={root}>{root === "." ? "repository root" : root}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {screens.length > 0 ? (
        <>
          <h3 className="gallery-group-title">Screens &amp; pages</h3>
          <div className="gallery-grid">{screens.map(renderCard)}</div>
        </>
      ) : null}

      {components.length > 0 ? (
        <>
          <h3 className="gallery-group-title">Components</h3>
          <div className="gallery-grid gallery-grid--components">{components.map(renderCard)}</div>
          {allComponents.length > components.length ? (
            <button type="button" className="gallery-more" onClick={() => setShowAllComponents(true)}>
              Show all {allComponents.length} components
            </button>
          ) : null}
        </>
      ) : null}

      {selected ? (
        <aside className="code-connection" aria-label="Code connection for the selected interface element">
          <div className="code-connection__heading">
            <div>
              <p className="section-label">Code connection</p>
              <h3>{selected.name}</h3>
            </div>
            <span className="gallery-card__kind">{selected.kindLabel}</span>
          </div>
          <dl>
            <div className="source-file-detail">
              <dt>Source file</dt>
              <dd>{selected.location.file}</dd>
              <CopyButton value={selected.location.file} label="File path" className="inline-copy-button" />
            </div>
            {selected.location.functionName ? (
              <div><dt>Symbol</dt><dd>{selected.location.functionName}</dd></div>
            ) : null}
            {selected.location.lineStart ? (
              <div>
                <dt>Lines</dt>
                <dd>
                  {selected.location.lineStart}
                  {selected.location.lineEnd && selected.location.lineEnd !== selected.location.lineStart
                    ? `–${selected.location.lineEnd}`
                    : ""}
                </dd>
              </div>
            ) : null}
            {selected.route ? <div><dt>Route</dt><dd>{selected.route}</dd></div> : null}
          </dl>
          <div className="relationship-grid">
            <div>
              <strong>Imports</strong>
              {selectedFile?.imports.length ? (
                <ul>{selectedFile.imports.map((item) => <li key={item}>{item}</li>)}</ul>
              ) : <small>None detected</small>}
            </div>
            <div>
              <strong>Dependents</strong>
              {selectedFile?.dependents.length ? (
                <ul>{selectedFile.dependents.map((item) => <li key={item}>{item}</li>)}</ul>
              ) : <small>None detected</small>}
            </div>
            <div>
              <strong>Styles</strong>
              {selected.styles.length ? (
                <ul>{selected.styles.map((item) => <li key={item}>{item}</li>)}</ul>
              ) : <small>None referenced</small>}
            </div>
            <div>
              <strong>Assets</strong>
              {selected.assets.length ? (
                <ul>{selected.assets.map((item) => <li key={item}>{item}</li>)}</ul>
              ) : <small>None referenced</small>}
            </div>
          </div>
          {selected.controls.length ? (
            <div className="detected-controls">
              <strong>Detected controls</strong>
              <ul>{selected.controls.map((control) => <li key={control}>{control}</li>)}</ul>
            </div>
          ) : null}
          {selected.componentNames.length ? (
            <div className="detected-controls">
              <strong>Components on this screen</strong>
              <ul>{selected.componentNames.map((name) => <li key={name}>{name}</li>)}</ul>
            </div>
          ) : null}
          <p className="code-connection__hint">
            This element is highlighted in the architecture graph below.
          </p>
        </aside>
      ) : (
        <p className="gallery-hint">Select a screen or component to see the code behind it.</p>
      )}
    </section>
  );
}
