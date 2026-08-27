import { describe, it, expect } from "vitest";
import {
  REGULATED_CHECK_MODES,
  REGULATED_HIDDEN_NAV,
  REGULATED_LOCKED_POLICY,
  isOnboardingSegment,
  isRegulatedTeam,
  isSharingPermitted,
} from "@/lib/segment/regulated";
import { CHECK_LAYERS } from "@/lib/verify/check-layers";

describe("regulated segment profile", () => {
  describe("check modes", () => {
    // The two tests that matter. A key that doesn't match a registered layer
    // id silently does nothing — the repo just keeps the product default and
    // nobody finds out until an auditor asks why perf evidence is in the
    // record. A layer with no key does the same thing in reverse.
    it("names only real check layers", () => {
      const known = new Set(CHECK_LAYERS.map((l) => l.id));
      for (const id of Object.keys(REGULATED_CHECK_MODES)) {
        expect(known, `unknown check layer "${id}"`).toContain(id);
      }
    });

    it("covers every registered check layer", () => {
      for (const layer of CHECK_LAYERS) {
        expect(
          REGULATED_CHECK_MODES,
          `check layer "${layer.id}" has no regulated default`,
        ).toHaveProperty(layer.id);
      }
    });

    it("enforces the layers a validated-system regression is bought for", () => {
      // Text is the load-bearing one: a template change that drops "Meaning"
      // from a 21 CFR Part 11 §11.50 manifestation is a compliance finding,
      // and the product default (`log`) would let it pass green.
      expect(REGULATED_CHECK_MODES.text).toBe("enforce");
      expect(REGULATED_CHECK_MODES.visual).toBe("enforce");
      expect(REGULATED_CHECK_MODES.dom).toBe("enforce");
    });

    it("uses only valid modes", () => {
      for (const [id, mode] of Object.entries(REGULATED_CHECK_MODES)) {
        expect(["enforce", "log", "disable"], `layer "${id}"`).toContain(mode);
      }
    });
  });

  describe("verdict policy", () => {
    it("never lets anything settle a case without a human", () => {
      expect(REGULATED_LOCKED_POLICY.autoApprove).toBe(false);
      expect(REGULATED_LOCKED_POLICY.confirmOnGreen).toBe(false);
      expect(REGULATED_LOCKED_POLICY.aiDiffing).toBe(false);
      expect(REGULATED_LOCKED_POLICY.builtInAi).toBe(false);
    });
  });

  describe("isRegulatedTeam", () => {
    it("is false for every absent-flag shape", () => {
      expect(isRegulatedTeam(null)).toBe(false);
      expect(isRegulatedTeam(undefined)).toBe(false);
      expect(isRegulatedTeam({})).toBe(false);
      // The column is nullable, and `null` must not read as "regulated".
      expect(isRegulatedTeam({ regulatedMode: null })).toBe(false);
      expect(isRegulatedTeam({ regulatedMode: false })).toBe(false);
    });

    it("is true only for an explicit true", () => {
      expect(isRegulatedTeam({ regulatedMode: true })).toBe(true);
    });
  });

  describe("isSharingPermitted", () => {
    it("refuses a regulated team and allows everyone else", () => {
      expect(isSharingPermitted({ regulatedMode: true })).toBe(false);
      expect(isSharingPermitted({ regulatedMode: false })).toBe(true);
      expect(isSharingPermitted(null)).toBe(true);
    });
  });

  describe("hidden nav", () => {
    it("hides the surfaces that read as a toy or produce non-deterministic runs", () => {
      expect(REGULATED_HIDDEN_NAV.has("Leaderboard")).toBe(true);
      expect(REGULATED_HIDDEN_NAV.has("Agents")).toBe(true);
    });

    it("keeps the surfaces the segment is actually here for", () => {
      // Verify is the review surface and Coverage is the PQ coverage matrix —
      // hiding either would leave the profile with no product in it.
      for (const kept of ["Verify", "Coverage", "Tests", "Runs", "Setup"]) {
        expect(REGULATED_HIDDEN_NAV.has(kept), kept).toBe(false);
      }
    });
  });

  describe("isOnboardingSegment", () => {
    it("accepts only the two forks", () => {
      expect(isOnboardingSegment("pharma")).toBe(true);
      expect(isOnboardingSegment("custom")).toBe(true);
      expect(isOnboardingSegment("PHARMA")).toBe(false);
      expect(isOnboardingSegment(null)).toBe(false);
      expect(isOnboardingSegment(undefined)).toBe(false);
    });
  });
});
