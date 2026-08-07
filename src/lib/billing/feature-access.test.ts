import { describe, it, expect } from "vitest";
import {
  hasQaAgentAccess,
  assertQaAgentAccess,
  QA_AGENT_MIN_PLAN,
} from "@/lib/billing/feature-access";

describe("hasQaAgentAccess", () => {
  describe("with billing configured (cloud)", () => {
    it("blocks tiers below the minimum", () => {
      expect(hasQaAgentAccess("free", true)).toBe(false);
      expect(hasQaAgentAccess("starter", true)).toBe(false);
      expect(hasQaAgentAccess("growth", true)).toBe(false);
    });

    it("allows the minimum tier", () => {
      expect(hasQaAgentAccess(QA_AGENT_MIN_PLAN, true)).toBe(true);
      expect(hasQaAgentAccess("pro", true)).toBe(true);
    });

    it("throws from the assert form for an under-tier plan", () => {
      expect(() => assertQaAgentAccess("free", true)).toThrow(/Pro plan/i);
    });
  });

  describe("without billing configured (self-hosted)", () => {
    // A self-hosted install has no Stripe config, so every team is `free`
    // forever with no route to upgrade. Gating there locks operators out of a
    // feature running on their own hardware — see PR #81 review.
    it("unlocks the feature for every plan", () => {
      expect(hasQaAgentAccess("free", false)).toBe(true);
      expect(hasQaAgentAccess("starter", false)).toBe(true);
      expect(hasQaAgentAccess("pro", false)).toBe(true);
    });

    it("does not throw from the assert form", () => {
      expect(() => assertQaAgentAccess("free", false)).not.toThrow();
    });
  });
});
