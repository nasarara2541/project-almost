import type {
  AuditCategory,
  AuditFinding,
  ContributionDifficulty,
  ContributionOpportunity,
  ContributorProfile,
} from "@/types/api";

const focusCategories: Record<Exclude<ContributorProfile["focus"], "any">, AuditCategory[]> = {
  docs: ["community", "developer-experience"],
  tests: ["testing"],
  cleanup: ["maintainability"],
  frontend: ["frontend-quality"],
};

export function focusMatchesFinding(finding: AuditFinding, profile: ContributorProfile) {
  return profile.focus === "any" || focusCategories[profile.focus].includes(finding.category);
}

export function contributionMatchScore(finding: AuditFinding, profile: ContributorProfile) {
  const severityScore = { high: 40, medium: 28, low: 14, info: 0 }[finding.severity];
  const confidenceScore = { high: 18, medium: 8, low: -20 }[finding.confidence];
  const timeScore: Record<ContributorProfile["time"], Record<ContributionDifficulty, number>> = {
    "half-hour": { "quick-win": 28, moderate: -8, substantial: -20 },
    "two-hours": { "quick-win": 20, moderate: 28, substantial: -6 },
    weekend: { "quick-win": 10, moderate: 22, substantial: 30 },
  };
  const experienceScore: Record<ContributorProfile["experience"], Record<ContributionDifficulty, number>> = {
    new: { "quick-win": 18, moderate: 4, substantial: -12 },
    comfortable: { "quick-win": 9, moderate: 16, substantial: 3 },
    advanced: { "quick-win": 2, moderate: 10, substantial: 18 },
  };
  const focusScore = profile.focus === "any" ? 0 : focusMatchesFinding(finding, profile) ? 30 : -10;

  return severityScore + confidenceScore + timeScore[profile.time][finding.difficulty]
    + experienceScore[profile.experience][finding.difficulty] + focusScore;
}

export function rankContributionMatches(
  findings: AuditFinding[],
  opportunities: ContributionOpportunity[],
  profile: ContributorProfile,
  limit = 3,
) {
  const opportunityFindingIds = new Set(opportunities.map((opportunity) => opportunity.findingId));
  return findings
    .filter((finding) => opportunityFindingIds.has(finding.id))
    .sort((a, b) => contributionMatchScore(b, profile) - contributionMatchScore(a, profile)
      || a.title.localeCompare(b.title))
    .slice(0, Math.max(0, limit));
}
