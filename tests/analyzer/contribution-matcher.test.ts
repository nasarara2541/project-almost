import { describe, expect, it } from "vitest";
import { rankContributionMatches } from "../../src/lib/audit/contribution-matcher";
import type {
  AuditFinding,
  ContributionOpportunity,
  ContributorProfile,
} from "../../src/types/api";

function finding(
  id: string,
  category: AuditFinding["category"],
  difficulty: AuditFinding["difficulty"],
  severity: AuditFinding["severity"] = "medium",
): AuditFinding {
  return {
    id,
    category,
    difficulty,
    severity,
    confidence: "high",
    title: id,
    summary: "Summary",
    whyItMatters: "Why",
    recommendation: "Action",
    evidence: [],
    files: [],
    contributionTask: "Task",
  };
}

function opportunities(findings: AuditFinding[]): ContributionOpportunity[] {
  return findings.map((item) => ({
    id: `opportunity:${item.id}`,
    findingId: item.id,
    title: item.title,
    impact: item.severity,
    difficulty: item.difficulty,
    summary: item.summary,
    task: item.contributionTask,
    files: item.files,
  }));
}

describe("contribution matching", () => {
  it("prioritizes the contributor's chosen type of work", () => {
    const docs = finding("docs", "community", "quick-win", "medium");
    const tests = finding("tests", "testing", "quick-win", "high");
    const profile: ContributorProfile = { experience: "new", time: "half-hour", focus: "docs" };

    expect(rankContributionMatches([tests, docs], opportunities([tests, docs]), profile)[0]?.id)
      .toBe("docs");
  });

  it("keeps substantial work away from a short session", () => {
    const quick = finding("quick", "maintainability", "quick-win", "medium");
    const substantial = finding("large", "maintainability", "substantial", "high");
    const profile: ContributorProfile = { experience: "new", time: "half-hour", focus: "any" };

    expect(rankContributionMatches([substantial, quick], opportunities([substantial, quick]), profile)[0]?.id)
      .toBe("quick");
  });

  it("returns only evidence-backed opportunities and caps the result", () => {
    const candidates = [
      finding("one", "community", "quick-win"),
      finding("two", "testing", "moderate"),
      finding("three", "maintainability", "moderate"),
      finding("four", "frontend-quality", "quick-win"),
    ];
    const profile: ContributorProfile = { experience: "comfortable", time: "two-hours", focus: "any" };

    const result = rankContributionMatches(candidates, opportunities(candidates.slice(0, 3)), profile, 2);

    expect(result).toHaveLength(2);
    expect(result.some((item) => item.id === "four")).toBe(false);
  });
});
