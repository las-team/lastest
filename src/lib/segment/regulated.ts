/**
 * The regulated (pharma / life-sciences) segment profile.
 *
 * One team flag — `teams.regulatedMode` — and one module every restriction
 * reads from, rather than a `team.regulatedMode &&` scattered across call
 * sites. See `docs/pharma-restricted-scope.md` §3 for the reasoning behind
 * each entry; this file is the executable form of those tables.
 *
 * Three rules it encodes:
 *   1. Nothing probabilistic produces a verdict. AI may author; never adjudicate.
 *   2. Nothing leaves the tenant without an authenticated identity attached.
 *   3. Nothing on screen suggests the tool is a game.
 *
 * Client-safe: types + plain data only, no DB and no `server-only`, because
 * the sidebar is a client component and has to filter itself.
 */

import type { CheckMode } from "@lastest/contracts";

/** The subset of `Team` this module needs. Keeps the sidebar and the server
 *  actions on the same predicate without either importing the other. */
export interface RegulatedTeamLike {
  regulatedMode?: boolean | null;
}

export function isRegulatedTeam(
  team: RegulatedTeamLike | null | undefined,
): boolean {
  return team?.regulatedMode === true;
}

/**
 * Check-layer modes applied to every repo created while the team is on the
 * regulated profile — the pharma onboarding fork AND `createLocalRepo` from
 * `/tests`, which is the same decision reached by a different route.
 *
 * These are *defaults*, not locks — the cogwheel dialog still lets a
 * validation lead change them, and a profile that silently overrode a
 * deliberate choice would be worse than one that never applied. The genuinely
 * non-negotiable settings live in `REGULATED_LOCKED_POLICY` below.
 *
 * Keyed by check-layer id (`src/lib/verify/core-check-layers.ts` for the 9
 * core layers, plus `a11y`/`design` contributed by their plugins).
 */
export const REGULATED_CHECK_MODES: Readonly<Record<string, CheckMode>> = {
  /** A release restyling a validated layout is the headline finding. */
  visual: "enforce",
  /** Product default is `log`. A template change that drops "Meaning" from a
   *  21 CFR Part 11 §11.50 signature manifestation is a compliance finding,
   *  not a cosmetic one — this is the most important default change here. */
  text: "enforce",
  /** "A configured component silently stopped rendering" is what the seeded
   *  Salesforce test hand-rolls against `records-lwc-highlights-panel`.
   *  Making it a layer is what stops every future test re-implementing it. */
  dom: "enforce",
  /** Product default is `enforce`. Vault and Lightning poll noisily enough
   *  that enforcing on day one buries the real findings under vendor traffic.
   *  Ratchet to `enforce` after one clean cycle. The write-guard does not ride
   *  on this mode — it gates regardless (see docs §2.2, not yet built). */
  network: "log",
  /** Same reason: vendor-owned console noise is not the customer's defect. */
  console: "log",
  /** Sandbox performance is non-deterministic and belongs to Veeva, not to
   *  the customer's validated configuration. */
  perf: "disable",
  /** Vault hash routing — a route that no longer resolves is a real
   *  regression, and a cheap one to catch. */
  url: "enforce",
  /** Nothing to assert against until the Vault REST/VQL connector exists
   *  (gap analysis B3a). Flip to `enforce` with it, not before. */
  api: "disable",
  /** Browser cookies / localStorage are not a GxP artifact; capturing them
   *  only adds review load to an execution cycle. */
  storage: "disable",
  /** A red a11y score on a vendor-owned UI is a finding against Veeva, not
   *  against the customer's configuration. Available on request; off here. */
  a11y: "disable",
  /** Design tokens are meaningless against a vendor-styled UI. */
  design: "disable",
};

/**
 * Settings that are forced, not defaulted.
 *
 * Rendered as visible-but-disabled controls rather than hidden ones: a
 * customer who can *see* that auto-approval is off trusts it more than one who
 * simply cannot find the switch.
 *
 * Applied through `lockedPolicyFor()` (the disabled controls) and
 * `isLockedSettingAllowed()` (the server-side refusal in
 * `updateAutoApproveDefaultBranch`, `updateBuiltInAiEnabled` and
 * `saveAISettings`). Both halves are required: a disabled switch is not a lock
 * on its own, since the action is still POST-able.
 */
export const REGULATED_LOCKED_POLICY = {
  /** An approval is an attributable human act. */
  autoApprove: false,
  /** A case must not silently settle itself into the execution record.
   *
   *  No product setting carries this yet — the Verify surface has no
   *  confirm-on-green switch to lock. It is stated here so the profile is
   *  complete and the day that switch ships it is already refused; unlike the
   *  other three entries, nothing enforces it today because there is nothing
   *  to enforce it against. */
  confirmOnGreen: false,
  /** A probabilistic verdict cannot be evidence. */
  aiDiffing: false,
  /** AI runs in the consultant's own agent, over MCP, outside the evidence
   *  path — not server-side against the tenant's data. */
  builtInAi: false,
} as const;

/**
 * Nav entries hidden under the regulated profile, keyed by the `name` used in
 * `src/components/layout/sidebar.tsx`.
 *
 * `Agents` covers the QA-agent planner and the Explorer, which the agents
 * console folded together: exploratory, non-deterministic run content cannot
 * be an execution record. The features stay reachable by URL — this is a
 * merchandising decision, not an access control. The one entry that is a real
 * control (public sharing) is refused server-side instead; see
 * `isSharingPermitted`.
 */
export const REGULATED_HIDDEN_NAV: ReadonlySet<string> = new Set([
  "Leaderboard",
  "Agents",
]);

/**
 * Settings cards hidden under the regulated profile, keyed by the `id` on the
 * `<Card>` (or the component name where the card has no id).
 *
 * Consulted through `isSettingHidden()` — `settings/page.tsx` must not
 * hardcode `!regulated &&` around each card, or this set becomes documentation
 * that looks like a mechanism and adding an id to it does nothing.
 */
export const REGULATED_HIDDEN_SETTINGS: ReadonlySet<string> = new Set([
  // Reads as a hobbyist toy to a validation lead, and produces no pipeline.
  "features-gamification",
  "gamification-admin",
  // Registers a demo user and sends mail from the product — unexplainable to
  // this buyer.
  "features-early-adopter",
  "features-quickstart-email",
  // A pharma QA lead has no repo. Same work as gap-analysis B1.
  "github",
  "gitlab",
  "github-actions",
  "gitlab-pipelines",
  // Enterprise procurement is not a Stripe portal.
  "billing",
]);

/**
 * Whether a settings card is hidden for this team.
 *
 * The one way `REGULATED_HIDDEN_SETTINGS` is applied, so adding an id to that
 * set is the whole change.
 */
export function isSettingHidden(
  id: string,
  team: RegulatedTeamLike | null | undefined,
): boolean {
  return isRegulatedTeam(team) && REGULATED_HIDDEN_SETTINGS.has(id);
}

/**
 * The locked settings for a team, or `null` when nothing is forced.
 *
 * `REGULATED_LOCKED_POLICY` is a policy table, not a mechanism: this is what
 * gives it a caller. Two consumers, and both are required for the guarantee to
 * hold — the settings UI renders the affected switches as visible-but-disabled
 * (so a customer can *see* auto-approval is off), and the server actions that
 * write these fields refuse a value that contradicts the policy. UI alone is
 * not a control; a POST would still flip the flag.
 */
export function lockedPolicyFor(
  team: RegulatedTeamLike | null | undefined,
): typeof REGULATED_LOCKED_POLICY | null {
  return isRegulatedTeam(team) ? REGULATED_LOCKED_POLICY : null;
}

/**
 * Whether a locked setting may be set to `value` for this team.
 *
 * Server-side half of `lockedPolicyFor`. Returns false only when the team is
 * regulated AND the requested value contradicts the policy — turning a locked
 * setting further *off* is always allowed.
 */
export function isLockedSettingAllowed(
  key: keyof typeof REGULATED_LOCKED_POLICY,
  value: boolean,
  team: RegulatedTeamLike | null | undefined,
): boolean {
  const policy = lockedPolicyFor(team);
  if (!policy) return true;
  return value === policy[key];
}

/**
 * Public, unauthenticated share links (`/r/<slug>`) under the regulated
 * profile.
 *
 * The single hard control in this module, and the reason it returns a boolean
 * rather than appearing in `REGULATED_HIDDEN_NAV`: an anonymous URL serving
 * screenshots of a validated system — potentially carrying HCP data — is a
 * data-protection problem, and hiding the button that mints one is not a
 * control. Callers must refuse server-side.
 */
export function isSharingPermitted(
  team: RegulatedTeamLike | null | undefined,
): boolean {
  return !isRegulatedTeam(team);
}

/**
 * Segment chosen at onboarding.
 *
 * `custom` is every existing user and the default; `pharma` is the fork that
 * sets `regulatedMode` and seeds the Vault + Salesforce suite.
 */
export type OnboardingSegment = "pharma" | "custom";

export function isOnboardingSegment(v: unknown): v is OnboardingSegment {
  return v === "pharma" || v === "custom";
}
