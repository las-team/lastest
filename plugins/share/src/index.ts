import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-share` — public share links. An operator on a build
 * detail page publishes a build/test to an unauthenticated `/r/<slug>`
 * landing page; a visitor can claim it, which signs them up and copies the
 * test definition into their new team. The eighth plugin of RFC §9 phase 4,
 * after `rca`, `app-map`, `launch`, `api-test`, `playground`, `gamification`
 * and `ci`.
 *
 * ### The standard tenanted shape
 *
 * Every row carries an `ownerTeamId`, and the wiring says so: `runtime` +
 * `host` + `data`, the same shape as `ci`/`explorer`. This plugin originally
 * shipped without a `runtime` because `PluginContext` carried less than the
 * host's own auth guards returned (user id/email, team name, repo name);
 * `ctx.actor` and the enriched `TeamRef` closed that gap, the identity
 * methods came off `ShareHost`, and every session path now authorizes
 * through `runtime.contextFor()` — see `wiring.ts` and `actions.ts`.
 *
 * ### The largest host port so far — read `host.ts` before concluding this
 * migration is small
 *
 * 14 methods, the biggest of any phase-4 plugin. The file header explains why
 * (this page renders nearly the same evidence the in-app build-detail view
 * does, just for an anonymous visitor) and what was deliberately kept OUT of
 * it: captions authoring (`src/lib/demo-captions/`, a distinct pipeline that
 * happens to write the same core column this plugin reads) and sitemap
 * enrichment (composed in `src/app/sitemap.ts` instead).
 */
export const sharePlugin = definePlugin({
  id: "share",
  title: "Public shares",

  capabilities: ["data"],

  // Loaded once at boot by `core/data`, which validates the `share_` prefix
  // before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present. Replaces a cascade that never
  // existed — see `deletion.ts`.
  deletion: createDeletionHook(),
});

export default sharePlugin;

export type {
  ClaimSourceTest,
  ShareBuild,
  ShareBuildRenderContext,
  ShareHost,
  ShareNotificationPayload,
  ShareStepComparison,
  SharePublishInfo,
  ShareTest,
  ShareTestResult,
  ShareTestRun,
  ShareVisualDiff,
} from "./host";
export { configureShare, isShareConfigured, type ShareWiring } from "./wiring";
export type {
  BuildA11yViolationRow,
  CapturedScreenshot,
  DemoNotes,
  RepoAward,
  StepComparisonEvidence,
  StepVerdict,
  VideoCaption,
} from "./types";
export type { PublicShare, PublicShareKind, PublicShareStatus } from "./schema";

// Server actions live behind `@lastest/plugin-share/actions`, the same
// subpath every other plugin uses. Re-exporting them here would also make
// this module (which `actions.ts` imports for the manifest) part of an
// import cycle with a `"use server"` file.
export {
  getPublicShareById,
  getPublicShareBySlug,
  getLatestPublicShareSlugForRepository,
  listPublicSharesForBuild,
  listPublicSharesForTest,
  listPublicSharesForRepositories,
  listIndexablePublicShares,
  revokePublicShareById,
  revokePublicSharesForTeam,
} from "./data/queries";

export { generateShareSlug, isValidShareSlug, buildShareUrl } from "./slug";
export { publicShareGrade } from "./grade";
export {
  buildXrayElements,
  buildXrayFromDomDiff,
  type XrayElement,
} from "./xray";
export {
  deriveShareFacts,
  formatShareDuration,
  hasRenderableVisualChange,
  type ShareFacts,
  type ShareFactsInput,
} from "./demo-facts";
export { projectShareA11y, dequeUniversityUrl } from "./a11y-projection";
export type { ShareA11yRule, ShareA11ySummary } from "./a11y-projection";
export { captionsToVtt, msToVttTimestamp } from "./vtt";
export { buildSocialCopy, type SocialCopy } from "./social-copy";
