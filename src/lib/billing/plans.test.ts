import { describe, it, expect, afterEach } from "vitest";
import {
  PLANS,
  PURCHASABLE_PLANS,
  planConfig,
  planRank,
  displayPriceCents,
  FALLBACK_PLAN,
} from "./plans";

describe("plans catalog", () => {
  describe("planConfig", () => {
    it("returns the catalog entry for each paid tier (run-minute quotas)", () => {
      expect(planConfig("free").monthlyRunQuota).toBe(500);
      expect(planConfig("starter").monthlyRunQuota).toBe(5000);
      expect(planConfig("growth").monthlyRunQuota).toBe(30000);
      expect(planConfig("pro").monthlyRunQuota).toBe(120000);
    });

    it("returns the read-only fallback for demo and trial", () => {
      expect(planConfig("demo")).toBe(FALLBACK_PLAN);
      expect(planConfig("trial")).toBe(FALLBACK_PLAN);
    });
  });

  describe("planRank", () => {
    it("ranks paid tiers above free", () => {
      expect(planRank("free")).toBeLessThan(planRank("starter"));
      expect(planRank("starter")).toBeLessThan(planRank("growth"));
      expect(planRank("growth")).toBeLessThan(planRank("pro"));
    });

    it("puts demo strictly below everything", () => {
      expect(planRank("demo")).toBeLessThan(planRank("free"));
    });
  });

  describe("displayPriceCents", () => {
    const originalEa = process.env.EARLY_ADOPTER_PRICING;

    afterEach(() => {
      if (originalEa === undefined) delete process.env.EARLY_ADOPTER_PRICING;
      else process.env.EARLY_ADOPTER_PRICING = originalEa;
    });

    it("returns the discounted monthly price by default (EA window on)", () => {
      delete process.env.EARLY_ADOPTER_PRICING;
      expect(displayPriceCents(PLANS.growth, "monthly")).toBe(
        PLANS.growth.earlyAdopterPriceCents,
      );
    });

    it("returns the full monthly price when EA flag is explicitly false", () => {
      process.env.EARLY_ADOPTER_PRICING = "false";
      expect(displayPriceCents(PLANS.growth, "monthly")).toBe(
        PLANS.growth.priceCents,
      );
    });

    it("returns the discounted yearly price by default", () => {
      delete process.env.EARLY_ADOPTER_PRICING;
      expect(displayPriceCents(PLANS.growth, "yearly")).toBe(
        PLANS.growth.earlyAdopterYearlyPriceCents,
      );
    });

    it("returns the full yearly price when EA is off", () => {
      process.env.EARLY_ADOPTER_PRICING = "false";
      expect(displayPriceCents(PLANS.growth, "yearly")).toBe(
        PLANS.growth.yearlyPriceCents,
      );
    });

    it("yearly price is exactly 10x monthly at the full tier (two months free)", () => {
      for (const p of [PLANS.starter, PLANS.growth, PLANS.pro]) {
        expect(p.yearlyPriceCents).toBe(p.priceCents * 10);
      }
    });

    it("keeps the free tier at $0 regardless of interval or flag", () => {
      process.env.EARLY_ADOPTER_PRICING = "false";
      expect(displayPriceCents(PLANS.free, "monthly")).toBe(0);
      expect(displayPriceCents(PLANS.free, "yearly")).toBe(0);
    });
  });

  describe("PURCHASABLE_PLANS", () => {
    it("lists tiers cheapest to priciest", () => {
      const prices = PURCHASABLE_PLANS.map((p) => p.priceCents);
      const sorted = [...prices].sort((a, b) => a - b);
      expect(prices).toEqual(sorted);
    });

    it("excludes non-purchasable tiers", () => {
      const ids = PURCHASABLE_PLANS.map((p) => p.id);
      expect(ids).not.toContain("free");
      expect(ids).not.toContain("demo");
      expect(ids).not.toContain("trial");
    });
  });
});
