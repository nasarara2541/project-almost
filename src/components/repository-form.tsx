import type {
  ContributionFocus,
  ContributionTime,
  ContributorExperience,
  ContributorProfile,
  GithubRepositoryOption,
} from "@/types/api";

type RepositoryFormProps = {
  repoUrl: string;
  isAnalyzing: boolean;
  verifiedDemo: boolean;
  profile: ContributorProfile;
  signedIn: boolean;
  authConfigured: boolean;
  repositories: GithubRepositoryOption[];
  onRepoUrlChange: (value: string) => void;
  onProfileChange: (profile: ContributorProfile) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function RepositoryForm({
  repoUrl,
  isAnalyzing,
  verifiedDemo,
  profile,
  signedIn,
  authConfigured,
  repositories,
  onRepoUrlChange,
  onProfileChange,
  onSubmit,
}: RepositoryFormProps) {
  return (
    <form className="repo-form repo-form--matching" onSubmit={onSubmit} aria-labelledby="repository-heading">
      <div className="repo-form__heading">
        <div>
          <span className="step-number">01</span>
          <div>
            <label id="repository-heading" htmlFor="repo-url">Start with a repository</label>
            <span className={verifiedDemo ? "verified-label" : "public-label"}>
              {verifiedDemo
                ? "Verified demo · ready to try"
                : signedIn
                  ? "Public or installed private repository · read-only analysis"
                  : "Public GitHub repository · read-only analysis"}
            </span>
          </div>
        </div>
      </div>

      <div className="repo-form__controls">
        <input
          id="repo-url"
          type="url"
          inputMode="url"
          placeholder="https://github.com/owner/project"
          list={repositories.length > 0 ? "installed-github-repositories" : undefined}
          value={repoUrl}
          onChange={(event) => onRepoUrlChange(event.target.value)}
          disabled={isAnalyzing}
          aria-describedby="repo-help"
          aria-label="Public GitHub repository URL"
          required
        />
        {repositories.length > 0 ? (
          <datalist id="installed-github-repositories">
            {repositories.map((repository) => (
              <option key={repository.url} value={repository.url}>{repository.name}</option>
            ))}
          </datalist>
        ) : null}
        <button type="submit" disabled={isAnalyzing}>
          {isAnalyzing ? "Finding matches…" : "Find tasks for me"}
        </button>
      </div>

      <fieldset className="contributor-profile">
        <legend>Make the results fit you</legend>
        <div className="contributor-profile__grid">
          <label>
            <span>Your experience</span>
            <select
              value={profile.experience}
              disabled={isAnalyzing}
              onChange={(event) => onProfileChange({
                ...profile,
                experience: event.target.value as ContributorExperience,
              })}
            >
              <option value="new">New contributor</option>
              <option value="comfortable">Comfortable with code</option>
              <option value="advanced">Experienced maintainer</option>
            </select>
          </label>
          <label>
            <span>Time available</span>
            <select
              value={profile.time}
              disabled={isAnalyzing}
              onChange={(event) => onProfileChange({
                ...profile,
                time: event.target.value as ContributionTime,
              })}
            >
              <option value="half-hour">About 30 minutes</option>
              <option value="two-hours">A couple of hours</option>
              <option value="weekend">A weekend</option>
            </select>
          </label>
          <label>
            <span>I prefer</span>
            <select
              value={profile.focus}
              disabled={isAnalyzing}
              onChange={(event) => onProfileChange({
                ...profile,
                focus: event.target.value as ContributionFocus,
              })}
            >
              <option value="any">Show me the best match</option>
              <option value="docs">Docs and community</option>
              <option value="tests">Tests and CI</option>
              <option value="cleanup">Cleanup and dead code</option>
              <option value="frontend">Frontend and accessibility</option>
            </select>
          </label>
        </div>
      </fieldset>

      <p id="repo-help" className="repo-form__help">
        RepoLens reads supported source files without executing repository code. Every result is
        labelled as confirmed or possible so you can verify it before making a change.
      </p>
      {signedIn ? (
        <p className="repo-form__access-note">
          Private repositories appear only when the RepoLens GitHub App is installed for them.
          Access is limited to repository metadata and read-only contents.
        </p>
      ) : authConfigured ? (
        <p className="repo-form__access-note">
          <a href="/api/auth/github">Connect GitHub</a> to save reports, rescan projects, and analyze installed private repositories.
        </p>
      ) : (
        <p className="repo-form__access-note">
          Public analysis is ready. Add the GitHub App credentials from <code>.env.example</code> to enable accounts and private repositories.
        </p>
      )}
    </form>
  );
}
