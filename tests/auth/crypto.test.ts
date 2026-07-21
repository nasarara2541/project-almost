import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashToken, seal, unseal } from "../../src/lib/auth/crypto";

const previousSecret = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-session-encryption";
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = previousSecret;
});

describe("session secret protection", () => {
  it("encrypts values with authenticated encryption", () => {
    const encrypted = seal("github-token");
    expect(encrypted).not.toContain("github-token");
    expect(unseal(encrypted)).toBe("github-token");
  });

  it("rejects tampered encrypted values", () => {
    const encrypted = seal("github-token");
    expect(() => unseal(`${encrypted}changed`)).toThrow();
  });

  it("hashes opaque session tokens before database storage", () => {
    expect(hashToken("session-token")).not.toBe("session-token");
    expect(hashToken("session-token")).toBe(hashToken("session-token"));
  });
});
