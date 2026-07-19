import type { RepositoryProjectInfo } from "@/types/api";

const projectTypeLabels: Record<RepositoryProjectInfo["projectType"], string> = {
  frontend: "Frontend application",
  monorepo: "Monorepo",
  library: "Library / package",
  cli: "Node.js CLI tool",
  "chrome-extension": "Chrome extension",
  python: "Python project",
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
  project: RepositoryProjectInfo;
  isStartingPreview: boolean;
  onStartPreview: (root: string) => void;
};

export function ProjectSummary({
  project,
  isStartingPreview,
  onStartPreview,
}: ProjectSummaryProps) {
  return (
    <section className="project-summary" aria-labelledby="project-summary-heading">
      <div className="project-summary__heading">
        <div>
          <p className="section-label">Analysis available</p>
          <h2 id="project-summary-heading">Repository profile</h2>
        </div>
        <span className={`availability availability--${project.previewAvailable ? "ready" : "unavailable"}`}>
          {project.previewAvailable ? "Preview available" : "Analysis only"}
        </span>
      </div>

      <dl className="project-facts">
        <div><dt>Project type</dt><dd>{projectTypeLabels[project.projectType]}</dd></div>
        <div><dt>Detected stack</dt><dd>{project.frameworks.map((framework) => frameworkLabels[framework] ?? framework).join(", ") || "None detected"}</dd></div>
        <div><dt>Package managers</dt><dd>{project.packageManagers.join(", ") || "Unknown"}</dd></div>
        <div><dt>Repository shape</dt><dd>{project.monorepo ? "Monorepo" : "Single project"}</dd></div>
      </dl>

      <div className="preview-availability">
        <strong>{project.previewAvailable ? "Live preview available" : "Live preview unavailable"}</strong>
        <p>{project.previewReason}</p>
      </div>

      <div className="subprojects">
        <div className="subprojects__heading">
          <strong>Detected subprojects</strong>
          <span>{project.subprojects.length}</span>
        </div>
        {project.subprojects.length ? (
          <ul>
            {project.subprojects.map((subproject) => {
              const preview = project.previewCandidates.find((candidate) => candidate.root === subproject.root);
              return (
                <li key={`${subproject.root}:${subproject.name}`}>
                  <div>
                    <strong>{subproject.name}</strong>
                    <code>{subproject.root}</code>
                  </div>
                  <span>{frameworkLabels[subproject.framework] ?? subproject.framework}</span>
                  <span>{subproject.packageManager}</span>
                  {preview?.available ? (
                    <button
                      type="button"
                      onClick={() => onStartPreview(subproject.root)}
                      disabled={isStartingPreview}
                    >
                      {isStartingPreview ? "Starting…" : "Start Live Preview"}
                    </button>
                  ) : (
                    <small title={preview?.reason ?? undefined}>
                      {subproject.runnable ? "Analysis only" : "Not runnable"}
                    </small>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="subprojects__empty">No runnable package roots were detected. Static analysis is still available above.</p>
        )}
      </div>
    </section>
  );
}
