/**
 * Tests for the webhook → app subscription sync.
 *
 * These cover the mapping logic the better-auth Stripe plugin invokes on
 * each lifecycle event — extracted from the plugin config so we can drive
 * them without standing up better-auth or Stripe. `@/lib/db/queries` is
 * mocked; the price-ID → tier reverse lookup is mocked at the catalog
 * boundary (`resolvePlanForPriceId`), whose own behaviour is covered by
 * `catalog.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as queries from "@/lib/db/queries";
import { resolvePlanForPriceId } from "./catalog";
import {
  syncTeamPlanForBilling,
  handleSubscriptionComplete,
  handleSubscriptionUpdate,
  handleSubscriptionDeleted,
} from "./webhook-sync";
import { planConfig } from "./plans";
import { getStripeClient } from "@/lib/billing/stripe";

vi.mock("@/lib/db/queries", () => ({
  getTeam: vi.fn(),
  updateTeam: vi.fn(),
}));

vi.mock("./catalog", () => ({
  resolvePlanForPriceId: vi.fn(),
  // Empty catalog → quotaForPlan falls back to the static planConfig
  // values, which is what these tests assert against.
  getCatalog: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/billing/stripe", () => ({
  getStripeClient: vi.fn(() => null),
}));

const getTeam = vi.mocked(queries.getTeam);
const updateTeam = vi.mocked(queries.updateTeam);
const resolvePrice = vi.mocked(resolvePlanForPriceId);
const stripeClient = vi.mocked(getStripeClient);

/** Stripe stub whose subscriptions.list returns the given subs. */
function fakeStripe(subs: Array<{ status: string; priceId: string }>) {
  return {
    subscriptions: {
      list: vi.fn().mockResolvedValue({
        data: subs.map((s) => ({
          status: s.status,
          items: { data: [{ price: { id: s.priceId } }] },
        })),
      }),
    },
  } as unknown as ReturnType<typeof getStripeClient>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // `getTeam` returns a team currently on free unless a test overrides it.
  getTeam.mockResolvedValue({ id: "team_1", plan: "free" } as never);
  updateTeam.mockResolvedValue(undefined as never);
  // Stripe unconfigured by default — deletion drops to free unless a test
  // wires up a surviving subscription.
  stripeClient.mockReturnValue(null);
  // Known price IDs resolve through the (mocked) dynamic catalog.
  resolvePrice.mockImplementation(async (priceId: string) => {
    if (priceId === "price_growth_monthly")
      return { plan: "growth", interval: "monthly" };
    if (priceId === "price_pro_yearly")
      return { plan: "pro", interval: "yearly" };
    return null;
  });
});

describe("syncTeamPlanForBilling", () => {
  it("updates plan + run quota when the tier changes", async () => {
    getTeam.mockResolvedValue({ id: "team_1", plan: "free" } as never);

    await syncTeamPlanForBilling("team_1", "growth");

    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "growth",
      monthlyRunQuota: planConfig("growth").monthlyRunQuota,
    });
  });

  it("is a no-op when the team is already on the target plan with the right quota", async () => {
    getTeam.mockResolvedValue({
      id: "team_1",
      plan: "growth",
      monthlyRunQuota: planConfig("growth").monthlyRunQuota,
    } as never);

    await syncTeamPlanForBilling("team_1", "growth");

    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("refreshes the quota on a same-plan event when it drifted", async () => {
    getTeam.mockResolvedValue({
      id: "team_1",
      plan: "growth",
      monthlyRunQuota: 3000,
    } as never);

    await syncTeamPlanForBilling("team_1", "growth");

    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "growth",
      monthlyRunQuota: planConfig("growth").monthlyRunQuota,
    });
  });

  it("is a no-op when the team no longer exists", async () => {
    getTeam.mockResolvedValue(null as never);

    await syncTeamPlanForBilling("missing", "pro");

    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("carries the correct quota for each tier", async () => {
    getTeam.mockResolvedValue({ id: "team_1", plan: "free" } as never);

    await syncTeamPlanForBilling("team_1", "pro");

    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "pro",
      monthlyRunQuota: planConfig("pro").monthlyRunQuota,
    });
  });
});

describe("handleSubscriptionComplete", () => {
  it("flips the team to the paid tier from the plan name", async () => {
    getTeam.mockResolvedValue({ id: "team_1", plan: "free" } as never);

    await handleSubscriptionComplete({
      subscription: { referenceId: "team_1" },
      plan: { name: "starter" },
    });

    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "starter",
      monthlyRunQuota: planConfig("starter").monthlyRunQuota,
    });
  });

  it("defaults to free when the plan name is absent", async () => {
    getTeam.mockResolvedValue({ id: "team_1", plan: "starter" } as never);

    await handleSubscriptionComplete({
      subscription: { referenceId: "team_1" },
      plan: { name: null },
    });

    // team was on starter, target resolves to free → update to free
    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "free",
      monthlyRunQuota: planConfig("free").monthlyRunQuota,
    });
  });
});

describe("handleSubscriptionUpdate", () => {
  it("maps the live Stripe price ID back to a tier (authoritative over the mirror)", async () => {
    getTeam.mockResolvedValue({ id: "team_1", plan: "starter" } as never);

    await handleSubscriptionUpdate({
      stripeSubscription: {
        items: { data: [{ price: { id: "price_growth_monthly" } }] },
      },
      // Mirror still says starter mid-proration; price ID must win.
      subscription: { referenceId: "team_1", plan: "starter" },
    });

    expect(resolvePrice).toHaveBeenCalledWith("price_growth_monthly");
    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "growth",
      monthlyRunQuota: planConfig("growth").monthlyRunQuota,
    });
  });

  it("falls back to the mirrored plan name when the price ID is unknown", async () => {
    getTeam.mockResolvedValue({ id: "team_1", plan: "free" } as never);

    await handleSubscriptionUpdate({
      stripeSubscription: {
        items: { data: [{ price: { id: "price_unrecognized" } }] },
      },
      subscription: { referenceId: "team_1", plan: "pro" },
    });

    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "pro",
      monthlyRunQuota: planConfig("pro").monthlyRunQuota,
    });
  });

  it("does nothing when neither the price ID nor the mirror resolves a plan", async () => {
    await handleSubscriptionUpdate({
      stripeSubscription: { items: { data: [] } },
      subscription: { referenceId: "team_1", plan: null },
    });

    expect(getTeam).not.toHaveBeenCalled();
    expect(updateTeam).not.toHaveBeenCalled();
  });
});

describe("handleSubscriptionDeleted", () => {
  it("drops the team back to the free tier", async () => {
    getTeam.mockResolvedValue({ id: "team_1", plan: "pro" } as never);

    await handleSubscriptionDeleted({
      subscription: { referenceId: "team_1" },
    });

    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "free",
      monthlyRunQuota: planConfig("free").monthlyRunQuota,
    });
  });

  it("keeps the surviving plan when another live subscription remains", async () => {
    // Cleanup of a duplicate: one sub is cancelled (fires this event) but
    // the team still has an active Pro sub — it must NOT drop to free.
    getTeam.mockResolvedValue({
      id: "team_1",
      plan: "pro",
      stripeCustomerId: "cus_1",
    } as never);
    stripeClient.mockReturnValue(
      fakeStripe([
        { status: "canceled", priceId: "price_growth_monthly" },
        { status: "active", priceId: "price_pro_yearly" },
      ]),
    );

    await handleSubscriptionDeleted({
      subscription: { referenceId: "team_1" },
    });

    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "pro",
      monthlyRunQuota: planConfig("pro").monthlyRunQuota,
    });
  });

  it("drops to free when the only remaining sub is canceled", async () => {
    getTeam.mockResolvedValue({
      id: "team_1",
      plan: "growth",
      stripeCustomerId: "cus_1",
    } as never);
    stripeClient.mockReturnValue(
      fakeStripe([{ status: "canceled", priceId: "price_growth_monthly" }]),
    );

    await handleSubscriptionDeleted({
      subscription: { referenceId: "team_1" },
    });

    expect(updateTeam).toHaveBeenCalledWith("team_1", {
      plan: "free",
      monthlyRunQuota: planConfig("free").monthlyRunQuota,
    });
  });
});
