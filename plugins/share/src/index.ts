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
 * ### Team-tenanted, but no `runtime` in its wiring
 *
 * Every row carries an `ownerTeamId`, so this is not the "no tenant at all"
 * shape `launch`/`playground` declared. What it shares with them is the
 * *wiring* shape (`data` straight from the slot, no `contextFor()`) — see
 * `wiring.ts` for why: every action already authorizes through
 * `ShareHost.requireRepoAccess`/`requireTeamAccess`, which return more than
 * `PluginContext` carries (user id, user email, team name, repo name), so a
 * second, kernel-level check would be redundant rather than additive.
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
  ShareRepoActor,
  ShareStepComparison,
  SharePublishInfo,
  ShareTeamActor,
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

export {
  claimAndRedirect,
  claimPublicShare,
  listBuildShares,
  listTestShares,
  publishBuildShare,
  publishLatestTestShare,
  revokePublicShare,
  type ClaimShareResult,
  type PublishShareResult,
} from "./actions";
export {
  getPublicShareById,
  getPublicShareBySlug,
  getLatestPublicShareSlugForRepository,
  listPublicSharesForBuild,
  listPublicSharesForTest,
  listPublicSharesForRepositories,
  listIndexablePublicShares,
  revokePublicShareById,
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
