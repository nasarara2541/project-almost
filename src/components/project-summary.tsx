import type { AnalyzeResult, RepositoryProjectInfo } from "@/types/api";

const projectTypeLabels: Record<RepositoryProjectInfo["projectType"], string> = {
  frontend: "Frontend application",
  monorepo: "Monorepo",
  library: "Library / package",
  cli: "Node.js CLI tool",
  "chrome-extension": "Chrome extension",
  python: "Python project",
  backend: "Backend service",
  mixed: "Mixed project",
  unknown: "Unclassified",
};

const frameworkLabels: Record<string, string> = {
  "chrome-extension": "Chrome extension",
  "node-cli": "Node CLI",
  library: "Library",
  python: "Python",
};

type ProjectSummaryProps = {
  analysis: AnalyzeResult;
};

export function ProjectSummary({ analysis }: ProjectSummaryProps) {
  const project = analysis.project;

  return (
    <section className="project-summary" aria-labelledby="project-summary-heading">
      <div className="project-summary__heading">
        <div>
          <p className="section-label">Repository overview</p>
          <h2 id="project-summary-heading">{analysis.name}</h2>
          {project.description ? <p className="project-description">{project.description}</p> : null}
        </div>
        <span
          className={`availability availability--${analysis.interface.hasVisualInterface ? "ready" : "unavailable"}`}
        >
          {analysis.interface.hasVisualInterface ? "Interface detected" : "No visual interface"}
        </span>
      </div>

      <dl className="project-facts">
        <div><dt>Project type</dt><dd>{projectTypeLabels[project.projectType]}</dd></div>
        <div><dt>Detected stack</dt><dd>{project.frameworks.map((framework) => frameworkLabels[framework] ?? framework).join(", ") || "None detected"}</dd></div>
        <div><dt>Package managers</dt><dd>{project.packageManagers.join(", ") || "Unknown"}</dd></div>
        <div><dt>Repository shape</dt><dd>{project.monorepo ? `Monorepo · ${project.subprojects.length} packages` : "Single project"}</dd></div>
        {project.defaultBranch ? <div><dt>Default branch</dt><dd>{project.defaultBranch}</dd></div> : null}
        <div><dt>Styling</dt><dd>{analysis.interface.tailwind ? "Tailwind CSS" : analysis.interface.styleFiles.length ? "CSS stylesheets" : "None detected"}</dd></div>
      </dl>

      {analysis.languages.length > 0 ? (
        <div className="language-breakdown" aria-label="Language breakdown">
          <strong>Languages</strong>
          <div className="language-bar" role="img" aria-label={analysis.languages.map((language) => `${language.name} ${language.percent}%`).join(", ")}>
            {analysis.languages.slice(0, 6).map((language, index) => (
              <span
                key={language.name}
                style={{ width: `${Math.max(language.percent, 2)}%` }}
                className={`language-bar__segment language-bar__segment--${index}`}
                title={`${language.name} ${language.percent}%`}
              />
            ))}
          </div>
          <ul>
            {analysis.languages.slice(0, 6).map((language, index) => (
              <li key={language.name}>
                <i className={`language-bar__segment--${index}`} />
                {language.name} <small>{language.percent}% · {language.files} files</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overview-columns">
        {analysis.entryPoints.length > 0 ? (
          <div>
            <strong>Entry points</strong>
            <ul>{analysis.entryPoints.slice(0, 6).map((entry) => <li key={entry.file}><code>{entry.file}</code></li>)}</ul>
          </div>
        ) : null}
        {analysis.importantFiles.length > 0 ? (
          <div>
            <strong>Important files</strong>
            <ul>{analysis.importantFiles.slice(0, 8).map((file) => <li key={file}><code>{file}</code></li>)}</ul>
          </div>
        ) : null}
        {analysis.folders.length > 0 ? (
          <div>
            <strong>Folder structure</strong>
            <ul className="folder-outline">{analysis.folders.slice(0, 14).map((folder) => <li key={folder}><code>{folder}</code></li>)}</ul>
          </div>
        ) : null}
      </div>

      {project.subprojects.length > 1 ? (
        <div className="subprojects">
          <div className="subprojects__heading">
            <strong>Detected packages</strong>
            <span>{project.subprojects.length}</span>
          </div>
          <ul>
            {project.subprojects.map((subproject) => (
              <li key={`${subproject.root}:${subproject.name}`}>
                <div>
                  <strong>{subproject.name}</strong>
                  <code>{subproject.root}</code>
                </div>
                <span>{frameworkLabels[subproject.framework] ?? subproject.framework}</span>
                <span>{subproject.packageManager}</span>
                <small>{subproject.runnable ? "runnable" : "not runnable"}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
