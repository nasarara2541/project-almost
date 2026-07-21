import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContributionVerificationError,
  contributionStatus,
  parsePullRequestUrl,
  type ContributionStatusEvidence,
} from "../../src/lib/contributions/verifier";
import { verifyGithubWebhookSignature } from "../../src/lib/contributions/webhook";

const baseline: ContributionStatusEvidence = {
  merged: false,
  changesRequested: false,
  approved: false,
  originalFindingResolved: false,
  analysisComplete: true,
  relevantFileCount: 0,
  newHighFindingCount: 0,
  checkState: "not-found",
};

describe("pull request contribution verification", () => {
  it("normalizes a GitHub pull request URL", () => {
    expect(parsePullRequestUrl("https://github.com/example/project/pull/42")).toEqual({
      owner: "example",
      repo: "project",
      pullNumber: 42,
      normalizedUrl: "https://github.com/example/project/pull/42",
    });
  });

  it("rejects issue URLs, non-GitHub hosts, and extra URL paths", () => {
    for (const value of [
      "https://github.com/example/project/issues/42",
      "https://example.com/example/project/pull/42",
      "https://github.com/example/project/pull/42/files",
    ]) {
      expect(() => parsePullRequestUrl(value)).toThrow(ContributionVerificationError);
    }
  });

  it("requires all automated evidence before calling a change verified", () => {
    expect(contributionStatus({ ...baseline, originalFindingResolved: true, relevantFileCount: 1 }))
      .toBe("implemented");
    expect(contributionStatus({ ...baseline, originalFindingResolved: true, checkState: "passing" }))
      .toBe("verified");
    expect(contributionStatus({ ...baseline, originalFindingResolved: true, approved: true }))
      .toBe("approved");
  });

  it("reports failed evidence as needs work and merge as accepted", () => {
    expect(contributionStatus({ ...baseline, checkState: "failing", originalFindingResolved: true }))
      .toBe("needs-work");
    expect(contributionStatus({ ...baseline, merged: true, checkState: "failing" }))
      .toBe("accepted");
  });
});

describe("GitHub webhook signatures", () => {
  it("accepts only a matching sha256 signature", () => {
    const body = JSON.stringify({ action: "completed" });
    const secret = "test-webhook-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyGithubWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyGithubWebhookSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyGithubWebhookSignature(body, null, secret)).toBe(false);
  });
});
