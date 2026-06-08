/**
 * Server-action tests for billing (v1, no admin review).
 *
 * The actions are intentionally thin: they enforce team-admin
 * capability and call the better-auth Stripe plugin endpoints via the
 * typed `api.ts` shim. The plugin's own lifecycle (webhook → DB sync,
 * customer create, proration math) is tested by @better-auth/stripe's
 * own suite. What we cover here is the wrapper logic that lives in
 * this repo:
 *
 *  1. Monthly vs yearly intent translation (`annual: boolean`).
 *  2. Short-circuit paths — no-op when same plan + interval, fall
 *     through to checkout when no active sub.
 *  3. Errors when Stripe is unconfigured / no active sub to cancel.
 *  4. Cancel goes through the plugin (Stripe Customer Portal) at
 *     period end — no reason picker, no immediate-cancel path.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth/capabilities", () => ({
  requireCapability: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  getTeamBilling: vi.fn(),
}));

vi.mock("@/lib/billing/api", () => ({
  callUpgradeSubscription: vi.fn(),
  callCancelSubscription: vi.fn(),
  callRestoreSubscription: vi.fn(),
  callBillingPortal: vi.fn(),
}));

vi.mock("@/lib/billing/stripe", () => ({
  getStripeClient: vi.fn(() => null),
}));

import { requireCapability } from "@/lib/auth/capabilities";
import * as queries from "@/lib/db/queries";
import {
  callUpgradeSubscription,
  callCancelSubscription,
  callRestoreSubscription,
  callBillingPortal,
} from "@/lib/billing/api";
import { getStripeClient } from "@/lib/billing/stripe";

/**
 * Minimal Stripe stub whose `subscriptions.list` returns the given live
 * subscriptions — used to drive the double-subscription safeguards.
 */
function fakeStripe(subs: Array<{ id: string; status: string }>) {
  return {
    subscriptions: { list: vi.fn().mockResolvedValue({ data: subs }) },
  } as unknown as ReturnType<typeof getStripeClient>;
}
import {
  startCheckout,
  changeTeamPlan,
  openCustomerPortal,
  cancelTeamSubscription,
  resumeTeamSubscription,
} from "./billing";

const TEAM = { id: "team-abc", name: "Acme", plan: "free" as const };
const SESSION = {
  team: TEAM,
  user: { id: "user-1", email: "admin@example.com" },
} as unknown as Awaited<ReturnType<typeof requireCapability>>;

const BILLING_NONE = {
  id: "team-abc",
  plan: "free" as const,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  subscriptionStatus: null,
  subscriptionCurrentPeriodEnd: null,
  subscriptionCancelAtPeriodEnd: false,
  subscriptionCancelAt: null,
  subscriptionScheduleId: null,
  subscriptionPlan: null,
  billingInterval: null,
  monthlyRunQuota: 50,
  subscriptionReferenceId: null,
};

const BILLING_ACTIVE_STARTER_MONTHLY = {
  id: "team-abc",
  plan: "starter" as const,
  stripeCustomerId: "cus_123",
  stripeSubscriptionId: "sub_123",
  subscriptionStatus: "active" as const,
  subscriptionCurrentPeriodEnd: new Date("2027-01-01"),
  subscriptionCancelAtPeriodEnd: false,
  subscriptionCancelAt: null,
  subscriptionScheduleId: null,
  subscriptionPlan: "starter" as const,
  billingInterval: "month",
  monthlyRunQuota: 500,
  subscriptionReferenceId: "team-abc",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCapability).mockResolvedValue(SESSION);
  // Default: Stripe unconfigured — the safeguards fall back to the local
  // subscription id and never block. Individual tests override this.
  vi.mocked(getStripeClient).mockReturnValue(null);
});

describe("startCheckout", () => {
  it("passes annual=false for monthly checkout and returns the plugin URL", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({
      url: "https://checkout.test/sess_1",
    });

    const result = await startCheckout("starter", "monthly");

    expect(result).toEqual({
      url: "https://checkout.test/sess_1",
      success: true,
    });
    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "starter",
        annual: false,
        customerType: "organization",
        referenceId: "team-abc",
        disableRedirect: true,
      }),
      expect.any(Headers),
    );
  });

  it("passes annual=true when interval is yearly", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({
      url: "https://checkout.test/sess_y",
    });

    await startCheckout("growth", "yearly");

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "growth", annual: true }),
      expect.any(Headers),
    );
  });

  it("rejects non-purchasable tiers without touching Stripe", async () => {
    await expect(startCheckout("free", "monthly")).rejects.toThrow(
      /not purchasable/i,
    );
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it("throws when the plugin returns no URL", async () => {
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});
    await expect(startCheckout("pro", "monthly")).rejects.toThrow(
      /checkout URL/i,
    );
  });

  it("requires team:admin capability", async () => {
    vi.mocked(requireCapability).mockRejectedValueOnce(
      new Error("Forbidden: missing capability team:admin"),
    );
    await expect(startCheckout("starter", "monthly")).rejects.toThrow(
      /Forbidden/,
    );
  });

  it("refuses to start a second Checkout when a live Stripe subscription exists", async () => {
    // The team already has a Stripe customer + live subscription. Starting
    // a fresh Checkout here would create a SECOND subscription — the bug
    // this guard exists to prevent.
    vi.mocked(queries.getTeamBilling).mockResolvedValue({
      ...BILLING_NONE,
      stripeCustomerId: "cus_dup",
    });
    vi.mocked(getStripeClient).mockReturnValue(
      fakeStripe([{ id: "sub_existing", status: "active" }]),
    );

    await expect(startCheckout("starter", "monthly")).rejects.toThrow(
      /already has a subscription/i,
    );
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it("allows Checkout when Stripe shows only an abandoned (incomplete) sub", async () => {
    // `incomplete` is an abandoned checkout that auto-expires; it must not
    // block the user from retrying.
    vi.mocked(queries.getTeamBilling).mockResolvedValue({
      ...BILLING_NONE,
      stripeCustomerId: "cus_x",
    });
    vi.mocked(getStripeClient).mockReturnValue(
      fakeStripe([{ id: "sub_incomplete", status: "incomplete" }]),
    );
    vi.mocked(callUpgradeSubscription).mockResolvedValue({
      url: "https://checkout.test/retry",
    });

    const result = await startCheckout("starter", "monthly");
    expect(result.success).toBe(true);
    expect(callUpgradeSubscription).toHaveBeenCalled();
  });

  it("does not write any audit-log row before redirecting to Checkout", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({
      url: "https://checkout.test/sess_audit",
    });

    await startCheckout("starter", "monthly");

    // The queries module is fully mocked above with only getTeamBilling.
    // Any audit-log call (logSubscriptionEvent) would surface here as
    // an undefined-function error — confirming the gate is gone.
    expect(Object.keys(queries)).not.toContain("logSubscriptionEvent");
  });
});

describe("changeTeamPlan", () => {
  it("falls through to startCheckout when the team has no active subscription", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({
      url: "https://checkout.test/fresh",
    });

    const result = await changeTeamPlan("growth", "monthly");

    expect(result).toEqual({
      url: "https://checkout.test/fresh",
      success: true,
    });
    expect(callUpgradeSubscription).toHaveBeenCalled();
  });

  it("short-circuits when the team is already on the requested plan + interval", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );

    const result = await changeTeamPlan("starter", "monthly");

    expect(result).toEqual({ success: true });
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it("calls upgrade with annual=true when switching the same plan to yearly", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan("starter", "yearly");

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "starter", annual: true }),
      expect.any(Headers),
    );
  });

  it("upgrades to a higher tier immediately (prorated, not scheduled)", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    const result = await changeTeamPlan("pro", "monthly");

    expect(result).toEqual({ success: true });
    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "pro",
        annual: false,
        scheduleAtPeriodEnd: false,
      }),
      expect.any(Headers),
    );
  });

  it("schedules a downgrade for the end of the billing period (like cancellation)", async () => {
    const billing = { ...BILLING_ACTIVE_STARTER_MONTHLY, plan: "pro" as const };
    vi.mocked(queries.getTeamBilling).mockResolvedValue(billing);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan("starter", "monthly");

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "starter",
        scheduleAtPeriodEnd: true,
        returnUrl: expect.stringContaining("billing=downgrade_scheduled"),
      }),
      expect.any(Headers),
    );
  });

  it("treats same-tier yearly→monthly as a scheduled downgrade", async () => {
    const billing = {
      ...BILLING_ACTIVE_STARTER_MONTHLY,
      billingInterval: "year",
    };
    vi.mocked(queries.getTeamBilling).mockResolvedValue(billing);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan("starter", "monthly");

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "starter",
        annual: false,
        scheduleAtPeriodEnd: true,
      }),
      expect.any(Headers),
    );
  });

  it("treats same-tier monthly→yearly as an immediate prorated change", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan("starter", "yearly");

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "starter",
        annual: true,
        scheduleAtPeriodEnd: false,
      }),
      expect.any(Headers),
    );
  });

  it("pins the change to the live Stripe subscription id (forces in-place update)", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(getStripeClient).mockReturnValue(
      fakeStripe([{ id: "sub_live", status: "active" }]),
    );
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan("pro", "monthly");

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "pro", subscriptionId: "sub_live" }),
      expect.any(Headers),
    );
  });

  it("refuses to change plan when Stripe shows multiple live subscriptions", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(getStripeClient).mockReturnValue(
      fakeStripe([
        { id: "sub_a", status: "active" },
        { id: "sub_b", status: "active" },
      ]),
    );

    await expect(changeTeamPlan("pro", "monthly")).rejects.toThrow(
      /multiple active subscriptions/i,
    );
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it("falls back to the local subscription id when Stripe is unconfigured", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(getStripeClient).mockReturnValue(null);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan("pro", "monthly");

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_123" }),
      expect.any(Headers),
    );
  });
});

describe("openCustomerPortal", () => {
  it("returns the portal URL from the plugin", async () => {
    vi.mocked(callBillingPortal).mockResolvedValue({
      url: "https://billing.stripe.com/p/sess_1",
    });

    const result = await openCustomerPortal();

    expect(result).toEqual({ url: "https://billing.stripe.com/p/sess_1" });
    expect(callBillingPortal).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: "team-abc",
        customerType: "organization",
      }),
      expect.any(Headers),
    );
  });

  it("throws when the plugin returns no URL", async () => {
    vi.mocked(callBillingPortal).mockResolvedValue({});
    await expect(openCustomerPortal()).rejects.toThrow(/no URL/i);
  });
});

describe("cancelTeamSubscription", () => {
  it("refuses to cancel when there is no active subscription", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);

    await expect(cancelTeamSubscription()).rejects.toThrow(
      /No active subscription/,
    );
    expect(callCancelSubscription).not.toHaveBeenCalled();
  });

  it("routes cancellation through the plugin (Stripe Customer Portal) at period end", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(callCancelSubscription).mockResolvedValue({
      url: "https://billing.stripe.com/p/cancel",
    });

    const result = await cancelTeamSubscription();

    expect(result).toEqual({
      url: "https://billing.stripe.com/p/cancel",
      success: true,
    });
    expect(callCancelSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: "team-abc",
        customerType: "organization",
      }),
      expect.any(Headers),
    );
  });

  it("accepts no arguments — no reason picker, no mode picker", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(callCancelSubscription).mockResolvedValue({});

    // Cancellation is a single click — no reason, no comment, no
    // immediate-vs-period-end picker. The action accepts zero arguments.
    const result = await cancelTeamSubscription();
    expect(result.success).toBe(true);
  });
});

describe("resumeTeamSubscription", () => {
  it("calls the plugin restore endpoint", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue({
      ...BILLING_ACTIVE_STARTER_MONTHLY,
      subscriptionCancelAtPeriodEnd: true,
    });
    vi.mocked(callRestoreSubscription).mockResolvedValue(undefined);

    const result = await resumeTeamSubscription();

    expect(result).toEqual({ success: true });
    expect(callRestoreSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: "team-abc",
        customerType: "organization",
      }),
      expect.any(Headers),
    );
  });

  it("refuses when there is no subscription to resume", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);

    await expect(resumeTeamSubscription()).rejects.toThrow(/No subscription/);
    expect(callRestoreSubscription).not.toHaveBeenCalled();
  });

  it("refuses to resume a subscription that is not scheduled for cancellation", async () => {
    // Active, non-cancelled sub: there is nothing to restore. Resuming
    // would be a no-op at Stripe and implies a UI state that can't happen.
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );

    await expect(resumeTeamSubscription()).rejects.toThrow(
      /not scheduled for cancellation/i,
    );
    expect(callRestoreSubscription).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────
// Authorization, tenant-ownership, input validation, and error
// propagation. These cover the guards added after review: every mutating
// action enforces team:admin, asserts the picked subscription belongs to
// the session team, rejects unknown plan tiers, blocks plan changes on a
// past_due sub, and surfaces (does not swallow) plugin/Stripe errors.
// ───────────────────────────────────────────────────────────────────────

describe("authorization (team:admin enforced on every mutating action)", () => {
  const FORBIDDEN = new Error("Forbidden: missing capability team:admin");

  it("changeTeamPlan requires team:admin before touching billing", async () => {
    vi.mocked(requireCapability).mockRejectedValueOnce(FORBIDDEN);
    await expect(changeTeamPlan("pro", "monthly")).rejects.toThrow(/Forbidden/);
    expect(queries.getTeamBilling).not.toHaveBeenCalled();
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it("openCustomerPortal requires team:admin", async () => {
    vi.mocked(requireCapability).mockRejectedValueOnce(FORBIDDEN);
    await expect(openCustomerPortal()).rejects.toThrow(/Forbidden/);
    expect(callBillingPortal).not.toHaveBeenCalled();
  });

  it("cancelTeamSubscription requires team:admin", async () => {
    vi.mocked(requireCapability).mockRejectedValueOnce(FORBIDDEN);
    await expect(cancelTeamSubscription()).rejects.toThrow(/Forbidden/);
    expect(callCancelSubscription).not.toHaveBeenCalled();
  });

  it("resumeTeamSubscription requires team:admin", async () => {
    vi.mocked(requireCapability).mockRejectedValueOnce(FORBIDDEN);
    await expect(resumeTeamSubscription()).rejects.toThrow(/Forbidden/);
    expect(callRestoreSubscription).not.toHaveBeenCalled();
  });
});

describe("tenant ownership (fail closed on a foreign subscription)", () => {
  // A subscription row whose referenceId is NOT the session team — the
  // shape `requireCapability` returning an external teamId would produce.
  const FOREIGN_SUB = {
    ...BILLING_ACTIVE_STARTER_MONTHLY,
    subscriptionReferenceId: "team-someone-else",
  };

  it("changeTeamPlan refuses to mutate a subscription owned by another team", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(FOREIGN_SUB);
    await expect(changeTeamPlan("pro", "monthly")).rejects.toThrow(
      /does not belong to the active team/i,
    );
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it("cancelTeamSubscription refuses a subscription owned by another team", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(FOREIGN_SUB);
    await expect(cancelTeamSubscription()).rejects.toThrow(
      /does not belong to the active team/i,
    );
    expect(callCancelSubscription).not.toHaveBeenCalled();
  });

  it("openCustomerPortal refuses a customer owned by another team", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(FOREIGN_SUB);
    await expect(openCustomerPortal()).rejects.toThrow(
      /does not belong to the active team/i,
    );
    expect(callBillingPortal).not.toHaveBeenCalled();
  });
});

describe("input validation", () => {
  it("changeTeamPlan rejects an unknown plan tier without touching Stripe", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    // 'enterprise' is not a real tier — caught before any plugin call.
    await expect(
      changeTeamPlan("enterprise" as unknown as "pro", "monthly"),
    ).rejects.toThrow(/unknown plan tier/i);
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it("startCheckout rejects an unknown plan tier", async () => {
    await expect(
      startCheckout("enterprise" as unknown as "pro", "monthly"),
    ).rejects.toThrow(/unknown plan tier/i);
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });
});

describe("past_due / unpaid subscriptions block plan changes", () => {
  it("changeTeamPlan refuses to upgrade a past_due subscription", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue({
      ...BILLING_ACTIVE_STARTER_MONTHLY,
      subscriptionStatus: "past_due" as const,
    });
    await expect(changeTeamPlan("pro", "monthly")).rejects.toThrow(
      /outstanding payment/i,
    );
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it("changeTeamPlan refuses to change an unpaid subscription", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue({
      ...BILLING_ACTIVE_STARTER_MONTHLY,
      subscriptionStatus: "unpaid" as const,
    });
    await expect(changeTeamPlan("growth", "monthly")).rejects.toThrow(
      /outstanding payment/i,
    );
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });
});

describe("plugin error propagation (failures are surfaced, not swallowed)", () => {
  it("startCheckout propagates a plugin/Stripe error", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);
    vi.mocked(callUpgradeSubscription).mockRejectedValue(
      new Error("Stripe API error: rate limited"),
    );
    await expect(startCheckout("starter", "monthly")).rejects.toThrow(
      /Stripe API error/,
    );
  });

  it("changeTeamPlan propagates a plugin/Stripe error", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(callUpgradeSubscription).mockRejectedValue(
      new Error("network failure"),
    );
    await expect(changeTeamPlan("pro", "monthly")).rejects.toThrow(
      /network failure/,
    );
  });

  it("openCustomerPortal propagates a plugin/Stripe error", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(callBillingPortal).mockRejectedValue(
      new Error("portal session failed"),
    );
    await expect(openCustomerPortal()).rejects.toThrow(/portal session failed/);
  });

  it("cancelTeamSubscription propagates a plugin/Stripe error", async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(
      BILLING_ACTIVE_STARTER_MONTHLY,
    );
    vi.mocked(callCancelSubscription).mockRejectedValue(
      new Error("cancel failed"),
    );
    await expect(cancelTeamSubscription()).rejects.toThrow(/cancel failed/);
  });
});
