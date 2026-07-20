import { CopyButton } from "@/components/copy-button";

type RepositoryFormProps = {
  repoUrl: string;
  isAnalyzing: boolean;
  verifiedDemo: boolean;
  onRepoUrlChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function RepositoryForm({
  repoUrl,
  isAnalyzing,
  verifiedDemo,
  onRepoUrlChange,
  onSubmit,
}: RepositoryFormProps) {
  return (
    <form className="repo-form" onSubmit={onSubmit} aria-labelledby="repository-heading">
      <div className="repo-form__heading">
        <div>
          <span className="step-number">01</span>
          <div>
            <label id="repository-heading" htmlFor="repo-url">Choose a repository</label>
            <span className={verifiedDemo ? "verified-label" : "public-label"}>
              {verifiedDemo ? "Verified demo repository" : "Public GitHub repository · read-only analysis"}
            </span>
          </div>
        </div>
        <CopyButton value={repoUrl} label="Repository URL" />
      </div>
      <div className="repo-form__controls">
        <input
          id="repo-url"
          type="url"
          inputMode="url"
          placeholder="https://github.com/owner/frontend-app"
          value={repoUrl}
          onChange={(event) => onRepoUrlChange(event.target.value)}
          disabled={isAnalyzing}
          aria-describedby="repo-help"
          aria-label="Verified public GitHub repository URL"
          required
        />
        <button type="submit" disabled={isAnalyzing}>
          {isAnalyzing ? "Analyzing repository…" : "Analyze Repository"}
        </button>
      </div>
      <p id="repo-help" className="repo-form__help">
        Public github.com repositories within the documented safety limits are supported. Common
        URL forms are normalized; source is fetched read-only and never executed.
      </p>
    </form>
  );
}
