/**
 * REST API v1 for VSCode Extension + MCP Server
 *
 * Provides authenticated HTTP endpoints wrapping server actions.
 *
 * Endpoints:
 *   GET  /api/v1/health - Health check
 *   GET  /api/v1/repos - List repositories
 *   GET  /api/v1/repos/:id - Get repository by ID
 *   GET  /api/v1/repos/:id/functional-areas - Get functional areas for repo
 *   GET  /api/v1/repos/:id/tests - Get tests for repo
 *   GET  /api/v1/repos/:id/builds - Get builds for repo
 *   GET  /api/v1/repos/:id/coverage - Get test coverage stats for repo
 *   GET  /api/v1/repos/:id/export - Export tests + functional areas (for migration)
 *   GET  /api/v1/functional-areas/:id - Get functional area
 *   GET  /api/v1/functional-areas/:id/tests - Get tests by functional area
 *   GET  /api/v1/tests/:id - Get single test
 *   GET  /api/v1/runs/:id - Get test run
 *   GET  /api/v1/builds/:id - Get build (slim by default; pass `?full=true` to include a11y/network/AI payloads on every diff)
 *   GET  /api/v1/builds/:id/demo-notes - Get demo-run UI/UX notes (404 if absent)
 *   POST /api/v1/builds/:id/demo-notes - Upsert demo-run UI/UX notes
 *   GET  /api/v1/diffs/:id - Get single visual diff
 *   GET  /api/v1/jobs/active - List active background jobs
 *   GET  /api/v1/jobs/:id - Get background job status
 *   POST /api/v1/runs - Create and run tests (optional `forceVideoRecording: true` in body — required for demo-style shares that render a video player)
 *   POST /api/v1/snapshot - Capture a single URL (synchronous; URL Diff feature)
 *   POST /api/v1/diff - Diff two URLs (async; returns jobId for polling)
 *   POST /api/v1/diffs/approve - Batch approve visual diffs
 *   POST /api/v1/diffs/reject - Batch reject visual diffs
 *   POST /api/v1/diffs/:id/approve - Approve single visual diff
 *   POST /api/v1/diffs/:id/reject - Reject single visual diff
 *   POST /api/v1/builds/:id/approve-all - Approve all diffs in a build
 *   POST /api/v1/builds/:id/share - Publish a public-share link for a build (optional `scopedTestId` in body)
 *   GET  /api/v1/builds/:id/shares - List public shares anchored on a build
 *   GET  /api/v1/tests/:id/shares - List public shares anchored on a test
 *   GET  /api/v1/shares/:id - Get a single share by id
 *   DELETE /api/v1/shares/:id - Revoke a public share
 *   POST /api/v1/repos - Create a local repository (optional baseUrl seeds env config)
 *   POST /api/v1/repos/:id/import - Import tests + functional areas (migration)
 *   POST /api/v1/functional-areas - Create functional area
 *   POST /api/v1/tests - Create a test directly with raw code (no AI)
 *   POST /api/v1/tests/create - Create test via AI
 *   POST /api/v1/tests/:id/heal - Heal a failing test via AI
 *   PUT  /api/v1/repos/:id - Update a repository (name/defaultBranch/selectedBranch/baseUrl)
 *   GET  /api/v1/repos/:id/playwright-settings - Get repo-level Playwright settings (merged with defaults)
 *   PUT  /api/v1/repos/:id/playwright-settings - Upsert repo-level Playwright settings (partial; whitelisted)
 *   PUT  /api/v1/tests/:id - Update a test (name/code/targetUrl/functionalAreaId/quarantined/executionMode/viewportOverride/playwrightOverrides/diffOverrides/stabilizationOverrides + setupTestId/setupScriptId/setupOverrides/teardownOverrides)
 *   PUT  /api/v1/functional-areas/:id - Update a functional area
 *   PUT  /api/v1/setup-scripts/:id - Update a setup script (name/type/code/description)
 *   GET  /api/v1/repos/:id/storage-states - List storage states (metadata only)
 *   POST /api/v1/repos/:id/storage-states - Create a storage state (Playwright storageState JSON)
 *   GET  /api/v1/storage-states/:id - Get a storage state (metadata; pass `?includeJson=true` + bearer to fetch the cookie/origin blob)
 *   DELETE /api/v1/storage-states/:id - Delete a storage state
 *   GET  /api/v1/repos/:id/setup-scripts - List setup scripts
 *   POST /api/v1/repos/:id/setup-scripts - Create a setup script
 *   GET  /api/v1/setup-scripts/:id - Get a setup script
 *   DELETE /api/v1/setup-scripts/:id - Delete a setup script (refuses if still wired into a test)
 *   DELETE /api/v1/tests/:id - Soft-delete a test
 *   DELETE /api/v1/functional-areas/:id - Soft-delete a functional area
 */

import { NextRequest, NextResponse } from "next/server";
import * as queries from "@/lib/db/queries";
import { createAndRunBuildCore } from "@/server/actions/builds";
import {
  batchApproveDiffsCore,
  batchRejectDiffsCore,
  approveDiffCore,
  rejectDiffCore,
  approveAllDiffsCore,
  getDiffCore,
} from "@/lib/diff/core";
import { awardScore } from "@/server/actions/gamification";
import { getCurrentSession } from "@/lib/auth";
import { startUrlDiff } from "@/server/actions/url-diff";
import { captureUrl, loadCaptureFromDisk } from "@/lib/url-diff/capture";
import { buildUrlDiff } from "@/lib/url-diff/engine";
import {
  validateTargetUrl,
  SsrfBlockedError,
  extractSourceIp,
} from "@/lib/url-diff/ssrf";
import { checkRateLimit } from "@/lib/url-diff/rate-limit";

// Helper to verify API auth. `getCurrentSession` already handles both cookie
// sessions and `Authorization: Bearer <token>` headers, so v1 and any
// downstream server actions share the same resolution path.
async function verifyAuth(_request: NextRequest) {
  return getCurrentSession();
}

// Map thrown auth errors from server actions to proper HTTP status codes
// (instead of opaque 500s). Server actions throw plain Errors with these
// prefixes — see `src/lib/auth/session.ts`.
function mapAuthError(error: unknown): NextResponse | null {
  const message = error instanceof Error ? error.message : "";
  if (message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (message.startsWith("Forbidden")) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  return null;
}

// Helper to parse slug (supports up to 4 levels: resource/id/subResource/action)
function parseSlug(slug: string[]): {
  resource: string;
  id?: string;
  subResource?: string;
  action?: string;
} {
  const [resource, id, subResource, action] = slug;
  return { resource, id, subResource, action };
}

// Validate + normalize a repo baseUrl. Returns the trimmed URL (no trailing
// slash) or `null` if invalid. The env_config layer trims again, but we
// normalize here so the value persisted matches what GET returns.
function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// Helper to verify a repository belongs to the session's team
async function verifyRepoOwnership(
  repoId: string,
  session: { team?: { id: string } | null },
) {
  const repo = await queries.getRepository(repoId);
  if (!repo || repo.teamId !== session.team?.id) return false;
  return true;
}

// Helper to verify a build belongs to the session's team (via test run → repo)
async function verifyBuildOwnership(
  buildId: string,
  session: { team?: { id: string } | null },
) {
  const build = await queries.getBuild(buildId);
  if (!build) return false;
  if (build.testRunId) {
    const testRun = await queries.getTestRun(build.testRunId);
    if (testRun?.repositoryId) {
      return verifyRepoOwnership(testRun.repositoryId, session);
    }
  }
  return false;
}

// Helper to verify a visual diff belongs to the session's team (via build)
async function verifyDiffOwnership(
  diffId: string,
  session: { team?: { id: string } | null },
) {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) return false;
  return verifyBuildOwnership(diff.buildId, session);
}

// Storage state list/get payload — strip storageStateJson, which contains
// cookies and auth tokens. Callers that need the raw blob must pass
// `?includeJson=true` AND be acting under a bearer token; we deliberately
// gate the secret material so a stolen cookie session can't trivially
// exfiltrate every session in the team.
type StorageStateRow = Awaited<ReturnType<typeof queries.getStorageState>>;
function slimStorageState(
  state: NonNullable<StorageStateRow>,
  includeJson = false,
) {
  const { storageStateJson, ...rest } = state;
  return includeJson ? { ...rest, storageStateJson } : rest;
}

// Verify a storage state belongs to the session's team (via its repository).
// Team-wide rows (repositoryId === null) are refused for cross-tenant safety;
// see requireStorageStateOwnership for the same reasoning.
async function verifyStorageStateOwnership(
  stateId: string,
  session: { team?: { id: string } | null },
) {
  const state = await queries.getStorageState(stateId);
  if (!state || !state.repositoryId) return { ok: false, state: null } as const;
  if (!(await verifyRepoOwnership(state.repositoryId, session))) {
    return { ok: false, state: null } as const;
  }
  return { ok: true, state } as const;
}

// Verify a public share belongs to the session's team. Shares carry both
// `ownerTeamId` (the team that published the share) and `repositoryId` (the
// underlying repo) — we trust the team binding directly and don't fall back
// to repo→team so a deleted repo can still be revoked.
async function verifyShareOwnership(
  shareId: string,
  session: { team?: { id: string } | null },
) {
  const share = await queries.getPublicShareById(shareId);
  if (!share) return { ok: false, share: null } as const;
  if (!session.team || share.ownerTeamId !== session.team.id) {
    return { ok: false, share: null } as const;
  }
  return { ok: true, share } as const;
}

// Verify a setup script belongs to the session's team (via its repository).
async function verifySetupScriptOwnership(
  scriptId: string,
  session: { team?: { id: string } | null },
) {
  const script = await queries.getSetupScript(scriptId);
  if (!script || !script.repositoryId)
    return { ok: false, script: null } as const;
  if (!(await verifyRepoOwnership(script.repositoryId, session))) {
    return { ok: false, script: null } as const;
  }
  return { ok: true, script } as const;
}

// Validate + normalize a TestPlaywrightOverrides payload. The schema column
// is `jsonb` so the DB will accept anything, but we don't want callers
// stuffing arbitrary keys (or wrong-typed values that crash the runner).
// Unknown keys are dropped silently — easier on agents — and bad types
// return an error so misuse fails loudly rather than persisting junk.
function normalizePlaywrightOverrides(
  raw: unknown,
):
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "playwrightOverrides must be an object or null",
    };
  }
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (r.browser !== undefined) {
    if (
      r.browser !== "chromium" &&
      r.browser !== "firefox" &&
      r.browser !== "webkit"
    ) {
      return {
        ok: false,
        error: 'browser must be "chromium" | "firefox" | "webkit"',
      };
    }
    out.browser = r.browser;
  }
  for (const key of [
    "navigationTimeout",
    "actionTimeout",
    "screenshotDelay",
    "maxParallelTests",
    "cursorPlaybackSpeed",
    "selectorTimeoutMs",
  ] as const) {
    if (r[key] === undefined) continue;
    if (
      typeof r[key] !== "number" ||
      !Number.isFinite(r[key]) ||
      (r[key] as number) < 0
    ) {
      return { ok: false, error: `${key} must be a non-negative number` };
    }
    out[key] = r[key];
  }
  for (const key of ["networkErrorMode", "consoleErrorMode"] as const) {
    if (r[key] === undefined) continue;
    if (r[key] !== "fail" && r[key] !== "warn" && r[key] !== "ignore") {
      return { ok: false, error: `${key} must be "fail" | "warn" | "ignore"` };
    }
    out[key] = r[key];
  }
  // Per-layer 3-way check modes (lets agents configure layer gating, incl. the
  // api layer, without the UI). enforce|log|disable.
  for (const key of [
    "visualMode",
    "textMode",
    "domMode",
    "networkMode",
    "consoleMode",
    "a11yMode",
    "designMode",
    "perfMode",
    "urlMode",
    "apiMode",
  ] as const) {
    if (r[key] === undefined) continue;
    if (r[key] !== "enforce" && r[key] !== "log" && r[key] !== "disable") {
      return {
        ok: false,
        error: `${key} must be "enforce" | "log" | "disable"`,
      };
    }
    out[key] = r[key];
  }
  if (r.acceptAnyCertificate !== undefined) {
    if (typeof r.acceptAnyCertificate !== "boolean") {
      return { ok: false, error: "acceptAnyCertificate must be boolean" };
    }
    out.acceptAnyCertificate = r.acceptAnyCertificate;
  }
  if (r.baseUrl !== undefined) {
    if (typeof r.baseUrl !== "string") {
      return { ok: false, error: "baseUrl must be a string" };
    }
    // Allow empty string to clear; otherwise validate URL shape.
    if (r.baseUrl) {
      try {
        const u = new URL(r.baseUrl);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          return { ok: false, error: "baseUrl must be http(s)" };
        }
      } catch {
        return { ok: false, error: "baseUrl must be a valid URL" };
      }
    }
    out.baseUrl = r.baseUrl;
  }
  return { ok: true, value: Object.keys(out).length === 0 ? null : out };
}

// Validate + normalize a partial PlaywrightSettings payload (repository-level).
// Only the runtime-relevant subset is accepted from the API — fields are
// pre-validated so the agent can't insert garbage into the jsonb columns.
// Unknown keys are dropped.
function normalizePlaywrightSettingsPatch(
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "playwrightSettings must be an object" };
  }
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // Strings (enums)
  if (r.browser !== undefined) {
    if (
      r.browser !== "chromium" &&
      r.browser !== "firefox" &&
      r.browser !== "webkit"
    ) {
      return {
        ok: false,
        error: 'browser must be "chromium" | "firefox" | "webkit"',
      };
    }
    out.browser = r.browser;
  }
  if (r.headlessMode !== undefined) {
    if (
      r.headlessMode !== "true" &&
      r.headlessMode !== "false" &&
      r.headlessMode !== "shell"
    ) {
      return {
        ok: false,
        error: 'headlessMode must be "true" | "false" | "shell"',
      };
    }
    out.headlessMode = r.headlessMode;
  }
  if (r.defaultRecordingEngine !== undefined) {
    if (
      r.defaultRecordingEngine !== "lastest" &&
      r.defaultRecordingEngine !== "playwright-inspector"
    ) {
      return {
        ok: false,
        error:
          'defaultRecordingEngine must be "lastest" | "playwright-inspector"',
      };
    }
    out.defaultRecordingEngine = r.defaultRecordingEngine;
  }
  for (const key of ["networkErrorMode", "consoleErrorMode"] as const) {
    if (r[key] === undefined) continue;
    if (r[key] !== "fail" && r[key] !== "warn" && r[key] !== "ignore") {
      return { ok: false, error: `${key} must be "fail" | "warn" | "ignore"` };
    }
    out[key] = r[key];
  }
  // Per-layer 3-way check modes (lets agents configure layer gating, incl. the
  // api layer, without the UI). enforce|log|disable.
  for (const key of [
    "visualMode",
    "textMode",
    "domMode",
    "networkMode",
    "consoleMode",
    "a11yMode",
    "designMode",
    "perfMode",
    "urlMode",
    "apiMode",
  ] as const) {
    if (r[key] === undefined) continue;
    if (r[key] !== "enforce" && r[key] !== "log" && r[key] !== "disable") {
      return {
        ok: false,
        error: `${key} must be "enforce" | "log" | "disable"`,
      };
    }
    out[key] = r[key];
  }
  if (r.customAttributeName !== undefined) {
    if (
      r.customAttributeName !== null &&
      typeof r.customAttributeName !== "string"
    ) {
      return {
        ok: false,
        error: "customAttributeName must be a string or null",
      };
    }
    out.customAttributeName = r.customAttributeName;
  }
  if (r.userAgentOverride !== undefined) {
    if (
      r.userAgentOverride !== null &&
      typeof r.userAgentOverride !== "string"
    ) {
      return { ok: false, error: "userAgentOverride must be a string or null" };
    }
    out.userAgentOverride =
      r.userAgentOverride === "" ? null : r.userAgentOverride;
  }
  if (r.consoleErrorIgnoreHosts !== undefined) {
    if (r.consoleErrorIgnoreHosts !== null) {
      if (
        !Array.isArray(r.consoleErrorIgnoreHosts) ||
        r.consoleErrorIgnoreHosts.some((s) => typeof s !== "string")
      ) {
        return {
          ok: false,
          error: "consoleErrorIgnoreHosts must be an array of strings or null",
        };
      }
    }
    out.consoleErrorIgnoreHosts = r.consoleErrorIgnoreHosts;
  }

  // Numbers (non-negative)
  for (const key of [
    "viewportWidth",
    "viewportHeight",
    "navigationTimeout",
    "actionTimeout",
    "selectorTimeoutMs",
    "cursorFPS",
    "cursorPlaybackSpeed",
    "screenshotDelay",
    "maxParallelTests",
    "maxParallelEBs",
    "ebPoolMax",
    "ebIdleTTLSeconds",
    "autoRetryCount",
  ] as const) {
    if (r[key] === undefined) continue;
    if (
      typeof r[key] !== "number" ||
      !Number.isFinite(r[key]) ||
      (r[key] as number) < 0
    ) {
      return { ok: false, error: `${key} must be a non-negative number` };
    }
    out[key] = r[key];
  }

  // Booleans
  for (const key of [
    "lockViewportToRecording",
    "pointerGestures",
    "freezeAnimations",
    "enableVideoRecording",
    "acceptAnyCertificate",
    "ignoreExternalNetworkErrors",
    "grantClipboardAccess",
    "acceptDownloads",
    "enableNetworkInterception",
    "enableDomDiff",
    "enableA11y",
  ] as const) {
    if (r[key] === undefined) continue;
    if (typeof r[key] !== "boolean") {
      return { ok: false, error: `${key} must be a boolean` };
    }
    out[key] = r[key];
  }

  // Arrays
  if (r.browsers !== undefined) {
    if (
      !Array.isArray(r.browsers) ||
      r.browsers.some(
        (b) => b !== "chromium" && b !== "firefox" && b !== "webkit",
      )
    ) {
      return {
        ok: false,
        error: 'browsers must be an array of "chromium" | "firefox" | "webkit"',
      };
    }
    if (r.browsers.length === 0) {
      return { ok: false, error: "browsers must contain at least one browser" };
    }
    out.browsers = r.browsers;
  }
  if (r.enabledRecordingEngines !== undefined) {
    if (
      !Array.isArray(r.enabledRecordingEngines) ||
      r.enabledRecordingEngines.some(
        (e) => e !== "lastest" && e !== "playwright-inspector",
      )
    ) {
      return {
        ok: false,
        error:
          'enabledRecordingEngines must be an array of "lastest" | "playwright-inspector"',
      };
    }
    out.enabledRecordingEngines = r.enabledRecordingEngines;
  }

  // Pass-through jsonb (stabilization, selectorPriority) — accept as-is if
  // shaped like an object/array. Deep validation lives in the settings UI.
  if (r.stabilization !== undefined) {
    if (
      r.stabilization !== null &&
      (typeof r.stabilization !== "object" || Array.isArray(r.stabilization))
    ) {
      return { ok: false, error: "stabilization must be an object or null" };
    }
    out.stabilization = r.stabilization;
  }
  if (r.selectorPriority !== undefined) {
    if (!Array.isArray(r.selectorPriority)) {
      return { ok: false, error: "selectorPriority must be an array" };
    }
    out.selectorPriority = r.selectorPriority;
  }

  if (Object.keys(out).length === 0) {
    return { ok: false, error: "No recognized fields to update" };
  }
  return { ok: true, value: out };
}

// Cap storageStateJson at 256 KB — Playwright storage state for a typical app
// is a few KB; anything larger is almost certainly accidental misuse and we
// don't want unbounded blobs landing in postgres.
const MAX_STORAGE_STATE_JSON_BYTES = 256 * 1024;
const MAX_SETUP_SCRIPT_CODE_BYTES = 128 * 1024;

// GET handler
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const { resource, id, subResource } = parseSlug(slug);

  try {
    // Health check
    if (resource === "health") {
      return NextResponse.json({
        ok: true,
        timestamp: new Date().toISOString(),
      });
    }

    // Repositories
    if (resource === "repos") {
      if (!id) {
        // GET /api/v1/repos - List all repos (each enriched with its env baseUrl)
        if (!session.team) {
          return NextResponse.json(
            { error: "No team access" },
            { status: 403 },
          );
        }
        const repos = await queries.getRepositoriesByTeam(session.team.id);
        const enriched = await Promise.all(
          repos.map(async (r) => {
            const env = await queries.getEnvironmentConfig(r.id);
            return { ...r, baseUrl: env?.baseUrl ?? null };
          }),
        );
        return NextResponse.json(enriched);
      }

      // GET /api/v1/repos/:id
      const repo = await queries.getRepository(id);
      if (!repo || repo.teamId !== session.team?.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      // Sub-resources
      if (subResource === "functional-areas") {
        const areas = await queries.getFunctionalAreasByRepo(id);
        return NextResponse.json(areas);
      }

      if (subResource === "tests") {
        const tests = await queries.getTestsByRepo(id);
        // Enrich with last run status
        const enrichedTests = await enrichTestsWithStatus(tests);
        return NextResponse.json(enrichedTests);
      }

      if (subResource === "builds") {
        const rawLimit = parseInt(
          request.nextUrl.searchParams.get("limit") || "10",
        );
        const limit = Math.min(
          Math.max(Number.isNaN(rawLimit) ? 10 : rawLimit, 1),
          100,
        );
        const builds = await queries.getBuildsByRepo(id, limit);
        return NextResponse.json(builds);
      }

      if (subResource === "playwright-settings") {
        const settings = await queries.getPlaywrightSettings(id);
        return NextResponse.json(settings);
      }

      if (subResource === "storage-states") {
        const states = await queries.getStorageStates(id);
        return NextResponse.json(states.map((s) => slimStorageState(s)));
      }

      if (subResource === "setup-scripts") {
        const scripts = await queries.getSetupScripts(id);
        return NextResponse.json(scripts);
      }

      if (subResource === "coverage") {
        const routeCoverage = await queries.getRouteCoverageStats(id);
        const areas = await queries.getFunctionalAreasByRepo(id);
        const tests = await queries.getTestsByRepo(id);
        const testedAreaIds = new Set(
          tests
            .filter((t) => t.functionalAreaId)
            .map((t) => t.functionalAreaId),
        );
        const areaCoverage = {
          total: areas.length,
          tested: areas.filter((a) => testedAreaIds.has(a.id)).length,
          percentage:
            areas.length > 0
              ? Math.round(
                  (areas.filter((a) => testedAreaIds.has(a.id)).length /
                    areas.length) *
                    100,
                )
              : 0,
        };
        return NextResponse.json({ routeCoverage, areaCoverage });
      }

      // GET /api/v1/repos/:id/export — full export for migration
      if (subResource === "export") {
        const areas = await queries.getFunctionalAreasByRepo(id);
        const areaMap = new Map(areas.map((a) => [a.id, a]));

        const exportedAreas = areas.map((a) => ({
          name: a.name,
          parentName: a.parentId
            ? (areaMap.get(a.parentId)?.name ?? null)
            : null,
          orderIndex: a.orderIndex,
          isRouteFolder: a.isRouteFolder,
          agentPlan: a.agentPlan,
        }));

        const repoTests = await queries.getTestsByRepo(id);
        const exportedTests = repoTests.map((t) => ({
          name: t.name,
          code: t.code,
          targetUrl: t.targetUrl,
          functionalAreaName: t.functionalAreaId
            ? (areaMap.get(t.functionalAreaId)?.name ?? null)
            : null,
          executionMode: t.executionMode,
          assertions: t.assertions,
          setupOverrides: t.setupOverrides,
          teardownOverrides: t.teardownOverrides,
          stabilizationOverrides: t.stabilizationOverrides,
          viewportOverride: t.viewportOverride,
          diffOverrides: t.diffOverrides,
          playwrightOverrides: t.playwrightOverrides,
          requiredCapabilities: t.requiredCapabilities,
          quarantined: t.quarantined,
          isPlaceholder: t.isPlaceholder,
        }));

        return NextResponse.json({
          functionalAreas: exportedAreas,
          tests: exportedTests,
        });
      }

      const env = await queries.getEnvironmentConfig(id);
      return NextResponse.json({ ...repo, baseUrl: env?.baseUrl ?? null });
    }

    // Functional areas
    if (resource === "functional-areas" && id) {
      const area = await queries.getFunctionalArea(id);
      if (!area) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Verify team ownership via repository
      if (area.repositoryId) {
        const areaRepo = await queries.getRepository(area.repositoryId);
        if (!areaRepo || areaRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      if (subResource === "tests") {
        const tests = await queries.getTestsByFunctionalArea(id);
        const enrichedTests = await enrichTestsWithStatus(tests);
        return NextResponse.json(enrichedTests);
      }
      return NextResponse.json(area);
    }

    // Tests
    if (resource === "tests" && id) {
      const test = await queries.getTest(id);
      if (!test) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Verify team ownership via repository
      if (test.repositoryId) {
        const testRepo = await queries.getRepository(test.repositoryId);
        if (!testRepo || testRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      if (subResource === "shares") {
        const shares = await queries.listPublicSharesForTest(id);
        return NextResponse.json(shares);
      }
      const [enriched] = await enrichTestsWithStatus([test]);
      return NextResponse.json(enriched);
    }

    // Public shares: GET /api/v1/shares/:id
    if (resource === "shares" && id) {
      const { ok, share } = await verifyShareOwnership(id, session);
      if (!ok || !share) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(share);
    }

    // Storage states: GET /api/v1/storage-states/:id (?includeJson=true to
    // get the cookie/origin blob — bearer-token only).
    if (resource === "storage-states" && id) {
      const { ok, state } = await verifyStorageStateOwnership(id, session);
      if (!ok || !state) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const wantJson =
        request.nextUrl.searchParams.get("includeJson") === "true";
      const isBearer = !!request.headers
        .get("authorization")
        ?.startsWith("Bearer ");
      if (wantJson && !isBearer) {
        return NextResponse.json(
          { error: "includeJson requires bearer-token auth" },
          { status: 403 },
        );
      }
      return NextResponse.json(slimStorageState(state, wantJson));
    }

    // Setup scripts: GET /api/v1/setup-scripts/:id
    if (resource === "setup-scripts" && id) {
      const { ok, script } = await verifySetupScriptOwnership(id, session);
      if (!ok || !script) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(script);
    }

    // Test runs
    if (resource === "runs" && id) {
      const run = await queries.getTestRun(id);
      if (!run) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Verify team ownership via repository
      if (run.repositoryId) {
        const runRepo = await queries.getRepository(run.repositoryId);
        if (!runRepo || runRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      const results = await queries.getTestResultsByRun(id);
      return NextResponse.json({ run, results });
    }

    // Visual diffs
    if (resource === "diffs" && id && !subResource) {
      // Verify team ownership via diff → build → test run → repo
      if (!(await verifyDiffOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const diff = await getDiffCore(id);
      if (!diff) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(diff);
    }

    // Background jobs — filter to jobs belonging to the session's team
    if (resource === "jobs") {
      if (!id || id === "active") {
        const activeJobs = (await queries.getActiveBackgroundJobs()) as Array<
          Record<string, unknown>
        >;
        const teamRepos = session.team
          ? await queries.getRepositoriesByTeam(session.team.id)
          : [];
        const teamRepoIds = new Set(teamRepos.map((r) => r.id));
        const filtered = activeJobs.filter(
          (j) => !j.repositoryId || teamRepoIds.has(j.repositoryId as string),
        );
        return NextResponse.json(filtered);
      }
      const job = (await queries.getBackgroundJob(id)) as Record<
        string,
        unknown
      > | null;
      if (!job) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Verify team ownership if job has a repositoryId
      if (job.repositoryId) {
        if (!(await verifyRepoOwnership(job.repositoryId as string, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      return NextResponse.json(job);
    }

    // Builds
    if (resource === "builds" && id) {
      // Verify-phase routes (v1.14+)
      // GET /api/v1/builds/:id/change-map
      if (subResource === "change-map") {
        if (!(await verifyBuildOwnership(id, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        const cached = await queries.getBuildChangeMap(id);
        if (cached) return NextResponse.json(cached);
        // Lazy compute on first request
        const { computeChangeMap } = await import("@/lib/change-map/compute");
        const computed = await computeChangeMap(id).catch(() => null);
        return NextResponse.json(
          computed ?? { error: "Unable to compute change map" },
        );
      }

      // GET /api/v1/builds/:id/verify — Change Map + step comparisons + verdict counts
      // + visual diff thumbnail URLs (C4) + per-test source/setup/storage map (C6).
      if (subResource === "verify") {
        if (!(await verifyBuildOwnership(id, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        const [changeMap, stepComparisons, counts, layerFeedback, visualDiffs] =
          await Promise.all([
            queries.getBuildChangeMap(id),
            queries.getStepComparisonsByBuild(id),
            queries.countStepComparisonVerdicts(id),
            queries.getLayerFeedbackByBuild(id),
            queries.getVisualDiffsByBuild(id),
          ]);
        // Build a {diffId → {baseline,current,diff} URL} map so each step
        // comparison's `visualDiffId` resolves to clickable image URLs without
        // an extra round-trip. URLs use `/api/media/<path>` — same bearer
        // token the MCP server already holds.
        const mediaUrl = (p: string | null | undefined) =>
          p ? `/api/media/${p.replace(/^\/+/, "")}` : null;
        const visualUrlsByDiffId: Record<
          string,
          {
            baselineUrl: string | null;
            currentUrl: string | null;
            diffUrl: string | null;
          }
        > = {};
        for (const d of visualDiffs) {
          visualUrlsByDiffId[d.id] = {
            baselineUrl: mediaUrl(d.baselineImagePath),
            currentUrl: mediaUrl(d.currentImagePath),
            diffUrl: mediaUrl(d.diffImagePath),
          };
        }
        // Per-test source / setup / storage resolution so the agent can read
        // the test code + how the test was wired without a chain of follow-up
        // calls. Keyed by testId — multiple step comparisons share one entry.
        const distinctTestIds = Array.from(
          new Set(
            stepComparisons
              .map((s) => s.testId)
              .filter((t): t is string => !!t),
          ),
        );
        const testRows =
          distinctTestIds.length > 0
            ? await Promise.all(
                distinctTestIds.map((tid) =>
                  queries.getTest(tid).catch(() => null),
                ),
              )
            : [];
        const testsByTestId: Record<
          string,
          {
            name: string;
            code: string;
            targetUrl: string | null;
            setupTestId: string | null;
            setupScriptId: string | null;
            storageStateId: string | null;
          }
        > = {};
        for (const t of testRows) {
          if (!t) continue;
          // storageStateId is sourced from a default_setup_step row if the
          // test inherits one; per-test override lives in setupOverrides JSON
          // (extraSteps[].storageStateId). Surface the test-record-level
          // hints; callers can use lastest_get_test for the full setup chain.
          const overrides = t.setupOverrides;
          const extraStorageStateStep = Array.isArray(overrides?.extraSteps)
            ? overrides.extraSteps.find(
                (s) => s.stepType === "storage_state" && s.storageStateId,
              )
            : undefined;
          testsByTestId[t.id] = {
            name: t.name,
            code: t.code,
            targetUrl: t.targetUrl ?? null,
            setupTestId: t.setupTestId ?? null,
            setupScriptId: t.setupScriptId ?? null,
            storageStateId: extraStorageStateStep?.storageStateId ?? null,
          };
        }
        return NextResponse.json({
          buildId: id,
          changeMap,
          stepComparisons,
          verdictCounts: counts,
          layerFeedback,
          visualUrlsByDiffId,
          testsByTestId,
        });
      }

      // GET /api/v1/builds/:id/shares — list public shares anchored on this build
      if (subResource === "shares") {
        if (!(await verifyBuildOwnership(id, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        const shares = await queries.listPublicSharesForBuild(id);
        return NextResponse.json(shares);
      }

      // GET /api/v1/builds/:id/demo-notes — AI UI/UX summary from a demo run
      if (subResource === "demo-notes") {
        if (!(await verifyBuildOwnership(id, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        const notes = await queries.getBuildDemoNotes(id);
        if (!notes)
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(notes);
      }

      const build = await queries.getBuild(id);
      if (!build) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const testRun = build.testRunId
        ? await queries.getTestRun(build.testRunId)
        : null;
      // Verify team ownership via repository on the test run
      if (testRun?.repositoryId) {
        const buildRepo = await queries.getRepository(testRun.repositoryId);
        if (!buildRepo || buildRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      const diffs = await queries.getVisualDiffsWithTestStatus(id);
      // Slim payload by default. The joined fields below can easily blow past
      // 100KB on a build with many diffs (network logs, a11y violations, AI
      // commentary, etc.) and saturate an agent's context. Callers that need
      // those payloads pass `?full=true`, or fetch per-diff with
      // GET /api/v1/diffs/:id (which always returns the full row).
      const full = request.nextUrl.searchParams.get("full") === "true";
      const responseDiffs = full
        ? diffs
        : diffs.map(
            ({
              a11yViolations: _a,
              consoleErrors: _c,
              networkRequests: _n,
              downloads: _d,
              aiAnalysis: _ai,
              metadata: _m,
              ...slim
            }) => slim,
          );
      return NextResponse.json({
        ...build,
        gitBranch: testRun?.gitBranch,
        gitCommit: testRun?.gitCommit,
        diffs: responseDiffs,
        ...(full ? {} : { diffsTrimmed: true }),
      });
    }

    // QuickStart agent session: GET /api/v1/quickstart/:sessionId
    if (resource === "quickstart" && id) {
      const sessionRow = await queries.getAgentSession(id);
      if (!sessionRow || sessionRow.kind !== "quickstart") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (sessionRow.teamId && sessionRow.teamId !== session.team?.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Surface demo notes inline once written, so the panel can auto-show them
      // without a second round-trip. Curated to the founder-safe fields the panel
      // renders (uxSummary + highlights + frictionPoints).
      const demoNotesRow = sessionRow.metadata.demoNotesId
        ? await queries
            .getBuildDemoNotes(sessionRow.metadata.demoNotesId)
            .catch(() => null)
        : null;
      const demoNotes = demoNotesRow
        ? {
            uxSummary: demoNotesRow.uxSummary,
            highlights: demoNotesRow.highlights ?? [],
            frictionPoints: demoNotesRow.frictionPoints ?? [],
          }
        : null;
      return NextResponse.json({
        id: sessionRow.id,
        kind: sessionRow.kind,
        repositoryId: sessionRow.repositoryId,
        status: sessionRow.status,
        currentStepId: sessionRow.currentStepId,
        steps: sessionRow.steps.map((s) => ({
          id: s.id,
          status: s.status,
          label: s.label,
          description: s.description,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          error: s.error,
          result: s.result,
        })),
        metadata: {
          quickstartEmail: sessionRow.metadata.quickstartEmail,
          quickstartSlug: sessionRow.metadata.quickstartSlug,
          publicScout: sessionRow.metadata.publicScout
            ? {
                classification: sessionRow.metadata.publicScout.classification,
                authAutomatable:
                  sessionRow.metadata.publicScout.authAutomatable,
                tagline: sessionRow.metadata.publicScout.tagline,
                concept: sessionRow.metadata.publicScout.concept,
                businessInteraction:
                  sessionRow.metadata.publicScout.businessInteraction,
              }
            : undefined,
          authSetup: sessionRow.metadata.authSetup,
          walkthroughTestId: sessionRow.metadata.walkthroughTestId,
          buildId: sessionRow.metadata.buildId,
          rerunBuildId: sessionRow.metadata.rerunBuildId,
          demoNotesId: sessionRow.metadata.demoNotesId,
          shareId: sessionRow.metadata.shareId,
          shareSlug: sessionRow.metadata.shareSlug,
          shareUrl: sessionRow.metadata.shareUrl,
          disabledReason: sessionRow.metadata.disabledReason,
          // Live browser view: the EB screencast URL is host-routable (rewritten
          // at auth-register) and carries no secrets — safe to surface so the
          // panel can render the scout's live browsing.
          streamUrl: sessionRow.metadata.streamUrl,
          queuedForBrowser: sessionRow.metadata.queuedForBrowser,
          demoNotes,
        },
        createdAt: sessionRow.createdAt,
        updatedAt: sessionRow.updatedAt,
        completedAt: sessionRow.completedAt,
      });
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const mapped = mapAuthError(error);
    if (mapped) return mapped;
    console.error("[API v1] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST handler
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const { resource, id, subResource } = parseSlug(slug);

  try {
    // Create storage state: POST /api/v1/repos/:id/storage-states
    // Body: { name, storageStateJson }
    if (resource === "repos" && id && subResource === "storage-states") {
      if (!(await verifyRepoOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const body = await request.json();
      const {
        name,
        storageStateJson,
        authFlavor,
        tokenLocations,
        firebaseApiKey,
        expiresAt,
      } = body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "name required" }, { status: 400 });
      }
      if (!storageStateJson || typeof storageStateJson !== "string") {
        return NextResponse.json(
          { error: "storageStateJson required" },
          { status: 400 },
        );
      }
      if (
        Buffer.byteLength(storageStateJson, "utf8") >
        MAX_STORAGE_STATE_JSON_BYTES
      ) {
        return NextResponse.json(
          {
            error: `storageStateJson exceeds ${MAX_STORAGE_STATE_JSON_BYTES} bytes`,
          },
          { status: 413 },
        );
      }
      let parsed: { cookies?: unknown; origins?: unknown };
      try {
        parsed = JSON.parse(storageStateJson);
      } catch {
        return NextResponse.json(
          { error: "storageStateJson must be valid JSON" },
          { status: 400 },
        );
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return NextResponse.json(
          {
            error: "storageStateJson must be a Playwright storageState object",
          },
          { status: 400 },
        );
      }
      if (parsed.cookies !== undefined && !Array.isArray(parsed.cookies)) {
        return NextResponse.json(
          { error: "storageStateJson.cookies must be an array" },
          { status: 400 },
        );
      }
      if (parsed.origins !== undefined && !Array.isArray(parsed.origins)) {
        return NextResponse.json(
          { error: "storageStateJson.origins must be an array" },
          { status: 400 },
        );
      }
      // Validate optional provenance metadata. Reject malformed values, but
      // accept absence — backwards-compatible with pre-2026-05-30 callers.
      if (
        authFlavor !== undefined &&
        authFlavor !== null &&
        typeof authFlavor !== "string"
      ) {
        return NextResponse.json(
          { error: "authFlavor must be a string" },
          { status: 400 },
        );
      }
      if (tokenLocations !== undefined && tokenLocations !== null) {
        if (
          !Array.isArray(tokenLocations) ||
          tokenLocations.some((s: unknown) => typeof s !== "string")
        ) {
          return NextResponse.json(
            { error: "tokenLocations must be an array of strings" },
            { status: 400 },
          );
        }
      }
      if (
        firebaseApiKey !== undefined &&
        firebaseApiKey !== null &&
        typeof firebaseApiKey !== "string"
      ) {
        return NextResponse.json(
          { error: "firebaseApiKey must be a string" },
          { status: 400 },
        );
      }
      let expiresAtDate: Date | null = null;
      if (expiresAt !== undefined && expiresAt !== null) {
        const d = new Date(expiresAt as string | number);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: "expiresAt must be an ISO date string or epoch ms" },
            { status: 400 },
          );
        }
        expiresAtDate = d;
      }
      const created = await queries.createStorageState({
        repositoryId: id,
        name: name.trim(),
        storageStateJson,
        authFlavor: (authFlavor as string | undefined) ?? null,
        tokenLocations: (tokenLocations as string[] | undefined) ?? null,
        firebaseApiKey: (firebaseApiKey as string | undefined) ?? null,
        expiresAt: expiresAtDate,
      });
      return NextResponse.json(slimStorageState(created), { status: 201 });
    }

    // Create setup script: POST /api/v1/repos/:id/setup-scripts
    // Body: { name, type, code, description? }
    if (resource === "repos" && id && subResource === "setup-scripts") {
      if (!(await verifyRepoOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const body = await request.json();
      const { name, type, code, description } = body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "name required" }, { status: 400 });
      }
      if (type !== "playwright" && type !== "api") {
        return NextResponse.json(
          { error: 'type must be "playwright" or "api"' },
          { status: 400 },
        );
      }
      if (!code || typeof code !== "string") {
        return NextResponse.json({ error: "code required" }, { status: 400 });
      }
      if (Buffer.byteLength(code, "utf8") > MAX_SETUP_SCRIPT_CODE_BYTES) {
        return NextResponse.json(
          { error: `code exceeds ${MAX_SETUP_SCRIPT_CODE_BYTES} bytes` },
          { status: 413 },
        );
      }
      if (type === "api") {
        const { validateApiScript } = await import("@/lib/setup/api-seeder");
        const validation = validateApiScript(code);
        if (!validation.valid) {
          return NextResponse.json(
            { error: `Invalid API script: ${validation.error}` },
            { status: 400 },
          );
        }
      }
      const created = await queries.createSetupScript({
        repositoryId: id,
        name: name.trim(),
        type,
        code,
        description: typeof description === "string" ? description : undefined,
      });
      return NextResponse.json(created, { status: 201 });
    }

    // Create local repository: POST /api/v1/repos
    if (resource === "repos" && !id) {
      if (!session.team) {
        return NextResponse.json({ error: "No team access" }, { status: 403 });
      }
      const body = await request.json();
      const { name, baseUrl } = body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "name required" }, { status: 400 });
      }
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
      if (baseUrl !== undefined && normalizedBaseUrl === null) {
        return NextResponse.json(
          { error: "baseUrl must be a valid http(s) URL" },
          { status: 400 },
        );
      }
      const repo = await queries.createRepository({
        teamId: session.team.id,
        provider: "local",
        owner: "local",
        name: name.trim(),
        fullName: name.trim(),
      });
      if (normalizedBaseUrl) {
        await queries.upsertEnvironmentConfig(repo.id, {
          baseUrl: normalizedBaseUrl,
        });
      }
      const env = await queries.getEnvironmentConfig(repo.id);
      return NextResponse.json(
        { ...repo, baseUrl: env?.baseUrl ?? null },
        { status: 201 },
      );
    }

    // Create test run
    if (resource === "runs" && !id) {
      const body = await request.json();
      const { testIds, functionalAreaId, repositoryId, forceVideoRecording } =
        body;

      let testIdsToRun: string[] = [];
      let scopedRepoId: string | null = null;

      // Verify ownership of every supplied id BEFORE doing anything.
      // Without this, a bearer-token holder for team A could trigger a
      // build under team B's repo by passing team B's testIds/repositoryId.
      if (repositoryId) {
        if (!(await verifyRepoOwnership(repositoryId, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        scopedRepoId = repositoryId;
      }

      if (testIds && testIds.length > 0) {
        for (const tid of testIds) {
          const t = await queries.getTest(tid);
          if (!t || !t.repositoryId) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
          }
          if (!(await verifyRepoOwnership(t.repositoryId, session))) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
          }
          if (scopedRepoId && t.repositoryId !== scopedRepoId) {
            return NextResponse.json(
              { error: "Tests must belong to the same repository" },
              { status: 400 },
            );
          }
          scopedRepoId ??= t.repositoryId;
        }
        testIdsToRun = testIds;
      } else if (functionalAreaId) {
        const area = await queries.getFunctionalArea(functionalAreaId);
        if (!area || !area.repositoryId) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (!(await verifyRepoOwnership(area.repositoryId, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (scopedRepoId && area.repositoryId !== scopedRepoId) {
          return NextResponse.json(
            { error: "Area does not belong to the supplied repository" },
            { status: 400 },
          );
        }
        scopedRepoId ??= area.repositoryId;
        const tests = await queries.getTestsByFunctionalArea(functionalAreaId);
        testIdsToRun = tests.map((t) => t.id);
      } else if (scopedRepoId) {
        const tests = await queries.getTestsByRepo(scopedRepoId);
        testIdsToRun = tests.map((t) => t.id);
      }

      if (testIdsToRun.length === 0) {
        return NextResponse.json({ error: "No tests to run" }, { status: 400 });
      }

      const result = await createAndRunBuildCore(
        "manual",
        testIdsToRun,
        scopedRepoId,
        undefined,
        undefined,
        undefined,
        forceVideoRecording === true || undefined,
      );

      return NextResponse.json(result);
    }

    // Diff-scoped validation: POST /api/v1/validate-diff
    // Body: { repositoryId, diff?, baseBranch?, headBranch?, wait?, maxWaitMs? }
    // Maps a code change → affected tests → runs only those → returns a verdict.
    if (resource === "validate-diff" && !id) {
      const body = (await request.json().catch(() => ({}))) as {
        repositoryId?: string;
        diff?: string;
        baseBranch?: string;
        headBranch?: string;
        wait?: boolean;
        maxWaitMs?: number;
      };
      if (!body.repositoryId || typeof body.repositoryId !== "string") {
        return NextResponse.json(
          { error: "repositoryId required" },
          { status: 400 },
        );
      }
      if (!(await verifyRepoOwnership(body.repositoryId, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { validateDiffCore, VALIDATE_DIFF_REQUEST_MAX_WAIT_MS } =
        await import("@/server/actions/validate-diff");
      // Cap the synchronous wait so a slow build can't hold the HTTP request
      // past proxy/ingress timeouts — past the cap the caller gets a
      // `build_running` verdict + buildId to poll.
      const maxWaitMs = Math.min(
        body.maxWaitMs ?? VALIDATE_DIFF_REQUEST_MAX_WAIT_MS,
        VALIDATE_DIFF_REQUEST_MAX_WAIT_MS,
      );
      const result = await validateDiffCore({
        repositoryId: body.repositoryId,
        diff: body.diff,
        baseBranch: body.baseBranch,
        headBranch: body.headBranch,
        wait: body.wait,
        maxWaitMs,
      });
      return NextResponse.json(result);
    }

    // URL Diff — single-URL synchronous capture: POST /api/v1/snapshot
    // Body: { url: string, viewport?: { width, height } }
    // Returns inline: { snapshotId, screenshotUrl, domSnapshot, networkRequests, a11yViolations, wcagScore }
    if (resource === "snapshot" && !id) {
      if (!session.team) {
        return NextResponse.json({ error: "No team access" }, { status: 403 });
      }
      const isBearer = !!request.headers
        .get("authorization")
        ?.startsWith("Bearer ");
      const sourceIp = extractSourceIp(request.headers);
      const rl = checkRateLimit({ ip: sourceIp, userId: session.user.id });
      if (!rl.ok) {
        return NextResponse.json(
          { error: "Rate limit exceeded" },
          { status: 429, headers: rl.headers },
        );
      }
      const body = (await request.json().catch(() => ({}))) as {
        url?: string;
        viewport?: { width: number; height: number };
      };
      if (!body.url || typeof body.url !== "string") {
        return NextResponse.json({ error: "url required" }, { status: 400 });
      }
      try {
        await validateTargetUrl(body.url, { sourceIp });
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          return NextResponse.json(
            { error: err.message },
            { status: 400, headers: rl.headers },
          );
        }
        throw err;
      }
      const snapshotId = crypto.randomUUID();
      try {
        const cap = await captureUrl({
          url: body.url,
          jobId: snapshotId,
          side: "a",
          viewport: body.viewport,
          poolTier: isBearer ? "build" : "interactive",
        });
        return NextResponse.json(
          {
            snapshotId,
            screenshotUrl: `/api/media${cap.screenshotRelPath}`,
            domSnapshot: cap.domSnapshot,
            networkRequests: cap.networkRequests,
            a11yViolations: cap.a11yViolations,
            a11yPassesCount: cap.a11yPassesCount,
            wcagScore: cap.wcagScore,
            capturedAt: cap.capturedAt,
          },
          { headers: rl.headers },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Capture failed";
        return NextResponse.json(
          { error: msg },
          { status: 502, headers: rl.headers },
        );
      }
    }

    // URL Diff — two-URL async diff: POST /api/v1/diff
    // Body: { urlA, urlB, viewport?, snapshotIdA?, snapshotIdB? }
    // Returns: { jobId, statusUrl } when capturing; or full result when both
    // snapshotIdA/snapshotIdB are provided and present on disk.
    if (resource === "diff" && !id) {
      if (!session.team) {
        return NextResponse.json({ error: "No team access" }, { status: 403 });
      }
      const isBearer = !!request.headers
        .get("authorization")
        ?.startsWith("Bearer ");
      const sourceIp = extractSourceIp(request.headers);
      const rl = checkRateLimit({ ip: sourceIp, userId: session.user.id });
      if (!rl.ok) {
        return NextResponse.json(
          { error: "Rate limit exceeded" },
          { status: 429, headers: rl.headers },
        );
      }
      const body = (await request.json().catch(() => ({}))) as {
        urlA?: string;
        urlB?: string;
        viewport?: { width: number; height: number };
        snapshotIdA?: string;
        snapshotIdB?: string;
      };

      // Snapshot reuse: both ids supplied and present → diff synchronously.
      if (body.snapshotIdA && body.snapshotIdB) {
        const [capA, capB] = await Promise.all([
          loadCaptureFromDisk(body.snapshotIdA, "a"),
          loadCaptureFromDisk(body.snapshotIdB, "a"),
        ]);
        if (!capA || !capB) {
          return NextResponse.json(
            { error: "snapshot expired or not found — recapture and retry" },
            { status: 404, headers: rl.headers },
          );
        }
        const stitchJobId = crypto.randomUUID();
        const result = await buildUrlDiff(capA, capB, stitchJobId);
        return NextResponse.json(result, { headers: rl.headers });
      }

      if (!body.urlA || !body.urlB) {
        return NextResponse.json(
          { error: "urlA and urlB required (or both snapshotIdA/snapshotIdB)" },
          { status: 400, headers: rl.headers },
        );
      }
      try {
        await Promise.all([
          validateTargetUrl(body.urlA, { sourceIp }),
          validateTargetUrl(body.urlB, { sourceIp }),
        ]);
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          return NextResponse.json(
            { error: err.message },
            { status: 400, headers: rl.headers },
          );
        }
        throw err;
      }

      const { jobId } = await startUrlDiff({
        urlA: body.urlA,
        urlB: body.urlB,
        viewport: body.viewport,
        poolTier: isBearer ? "build" : "interactive",
        sourceIp,
        repositoryId: null,
      });
      return NextResponse.json(
        { jobId, statusUrl: `/api/v1/jobs/${jobId}` },
        { headers: rl.headers, status: 202 },
      );
    }

    // Batch approve diffs
    if (resource === "diffs" && slug[1] === "approve") {
      const body = await request.json();
      const { diffIds } = body;
      if (!diffIds || !Array.isArray(diffIds) || diffIds.length === 0) {
        return NextResponse.json(
          { error: "diffIds array required" },
          { status: 400 },
        );
      }
      // Verify team ownership for all diffs
      for (const did of diffIds) {
        if (!(await verifyDiffOwnership(did, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      const result = await batchApproveDiffsCore(diffIds);
      return NextResponse.json(result);
    }

    // Batch reject diffs
    if (resource === "diffs" && slug[1] === "reject") {
      const body = await request.json();
      const { diffIds } = body;
      if (!diffIds || !Array.isArray(diffIds) || diffIds.length === 0) {
        return NextResponse.json(
          { error: "diffIds array required" },
          { status: 400 },
        );
      }
      // Verify team ownership for all diffs
      for (const did of diffIds) {
        if (!(await verifyDiffOwnership(did, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      const result = await batchRejectDiffsCore(diffIds);
      return NextResponse.json(result);
    }

    // Create test directly with raw code: POST /api/v1/tests
    // For API tests (E1) pass `testType: 'api'` + `apiDefinition` instead of code.
    if (resource === "tests" && !slug[1]) {
      const body = await request.json();
      const { repositoryId, name, functionalAreaId, targetUrl, description } =
        body;
      const testType = body.testType === "api" ? "api" : "browser";
      const apiDefinition = body.apiDefinition as
        | import("@/lib/db/schema").ApiTestDefinition
        | undefined;
      // API tests carry an apiDefinition; the `code` column stores a readable
      // JSON rendering of it (the column is NOT NULL). Browser tests require code.
      let code = body.code as string | undefined;
      if (testType === "api") {
        if (
          !apiDefinition ||
          typeof apiDefinition !== "object" ||
          !apiDefinition.method ||
          !apiDefinition.url
        ) {
          return NextResponse.json(
            {
              error: "apiDefinition with method and url required for api tests",
            },
            { status: 400 },
          );
        }
        if (
          !Array.isArray(apiDefinition.assertions) ||
          apiDefinition.assertions.length === 0
        ) {
          return NextResponse.json(
            { error: "apiDefinition.assertions must be a non-empty array" },
            { status: 400 },
          );
        }
        // The `code` column is human-visible and snapshotted into
        // test_versions — never let credentials land in it.
        const { renderApiDefinitionForCode } =
          await import("@/lib/api-test/redact");
        code =
          code && typeof code === "string"
            ? code
            : renderApiDefinitionForCode(apiDefinition);
      }
      if (!repositoryId) {
        return NextResponse.json(
          { error: "repositoryId required" },
          { status: 400 },
        );
      }
      if (!name || typeof name !== "string") {
        return NextResponse.json({ error: "name required" }, { status: 400 });
      }
      if (!code || typeof code !== "string") {
        return NextResponse.json({ error: "code required" }, { status: 400 });
      }
      if (!(await verifyRepoOwnership(repositoryId, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Validate functionalAreaId if provided
      if (functionalAreaId) {
        const area = await queries.getFunctionalArea(functionalAreaId);
        if (
          !area ||
          (area.repositoryId && area.repositoryId !== repositoryId)
        ) {
          return NextResponse.json(
            { error: "Invalid functionalAreaId" },
            { status: 400 },
          );
        }
      }
      // Stamp MCP bot as creator when available, so gamification & attribution work
      const mcpBot = await queries.getBotByKind(session.team!.id, "mcp_server");
      const created = await queries.createTest({
        repositoryId,
        name,
        code,
        testType,
        apiDefinition: testType === "api" ? apiDefinition : undefined,
        targetUrl:
          targetUrl ??
          (testType === "api" ? (apiDefinition?.url ?? null) : null),
        functionalAreaId: functionalAreaId ?? null,
        createdByBotId: mcpBot?.id ?? null,
        createdByUserId: mcpBot ? null : (session.user?.id ?? null),
      });
      // If a `description` was supplied via the legacy field, store it on the linked
      // test_specs row instead — that's where short-form intent lives now.
      if (description && typeof description === "string") {
        const { createHash } = await import("crypto");
        const codeHash = createHash("sha256").update(code).digest("hex");
        const specId = await queries.createTestSpec({
          repositoryId,
          testId: created.id,
          functionalAreaId: functionalAreaId ?? null,
          title: name,
          spec: description,
          source: "manual",
          status: "has_test",
          codeHash,
        });
        await queries.linkSpecToTest(specId, created.id);
      }
      return NextResponse.json(created, { status: 201 });
    }

    // Create test via AI
    if (resource === "tests" && slug[1] === "create" && !slug[2]) {
      const body = await request.json();
      const { repositoryId, url, prompt, functionalAreaId } = body;
      if (!repositoryId) {
        return NextResponse.json(
          { error: "repositoryId required" },
          { status: 400 },
        );
      }
      // Dynamic import to avoid pulling in heavy AI deps at route level
      const { createTest } = await import("@/server/actions/ai");
      const result = await createTest(repositoryId, {
        targetUrl: url,
        userPrompt: prompt,
        functionalAreaId,
      });
      // The agent swallows provider errors and returns { success: false, error }.
      // Map that back to a real HTTP status so MCP/REST callers can branch on it
      // — otherwise an overloaded LLM looks identical to a happy creation.
      if (!result.success) {
        const message = result.error ?? "AI test generation failed";
        const lower = message.toLowerCase();
        const isConfig =
          lower.includes("no api key") ||
          lower.includes("api key") ||
          lower.includes("not configured") ||
          (lower.includes("missing") && lower.includes("config"));
        const isOverloaded =
          lower.includes("overload") ||
          lower.includes("rate limit") ||
          lower.includes("429") ||
          lower.includes("503") ||
          lower.includes("502") ||
          lower.includes("timeout") ||
          lower.includes("upstream");
        const status = isConfig ? 503 : isOverloaded ? 502 : 422;
        return NextResponse.json(
          {
            success: false,
            error: message,
            retryable: !isConfig,
            fallback:
              "Try direct mode: POST /api/v1/tests with { name, code } using a Playwright snapshot you generate yourself.",
          },
          { status },
        );
      }
      return NextResponse.json(result);
    }

    // Heal a failing test via AI
    if (resource === "tests" && slug[2] === "heal") {
      const testId = slug[1];
      if (!testId) {
        return NextResponse.json({ error: "testId required" }, { status: 400 });
      }
      const test = await queries.getTest(testId);
      if (!test) {
        return NextResponse.json({ error: "Test not found" }, { status: 404 });
      }
      // Verify team ownership via repository
      if (test.repositoryId) {
        if (!(await verifyRepoOwnership(test.repositoryId, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      // Dynamic import to avoid pulling in heavy AI deps at route level
      const { agentHealTestCore } =
        await import("@/lib/playwright/healer-agent");
      const result = await agentHealTestCore(test.repositoryId!, testId);
      return NextResponse.json(result);
    }

    // Generate an API test via AI and persist it: POST /api/v1/tests/generate-api
    // Body: { repositoryId, name?, prompt?, endpoint?, openapiSpec?, graphqlSchema?, functionalAreaId? }
    if (resource === "tests" && slug[1] === "generate-api" && !slug[2]) {
      const body = (await request.json().catch(() => ({}))) as {
        repositoryId?: string;
        name?: string;
        prompt?: string;
        endpoint?: string;
        openapiSpec?: string;
        graphqlSchema?: string;
        functionalAreaId?: string;
      };
      if (!body.repositoryId) {
        return NextResponse.json(
          { error: "repositoryId required" },
          { status: 400 },
        );
      }
      if (!(await verifyRepoOwnership(body.repositoryId, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { generateApiTest } = await import("@/lib/api-test/generator");
      const gen = await generateApiTest({
        repositoryId: body.repositoryId,
        prompt: body.prompt,
        endpoint: body.endpoint,
        openapiSpec: body.openapiSpec,
        graphqlSchema: body.graphqlSchema,
      });
      if (gen.status !== "generated" || !gen.definition) {
        return NextResponse.json(
          { status: gen.status, error: gen.summary },
          { status: 422 },
        );
      }
      const mcpBot = await queries.getBotByKind(session.team!.id, "mcp_server");
      const name =
        body.name?.trim() || `${gen.definition.method} ${gen.definition.url}`;
      const { renderApiDefinitionForCode } =
        await import("@/lib/api-test/redact");
      const created = await queries.createTest({
        repositoryId: body.repositoryId,
        name,
        code: renderApiDefinitionForCode(gen.definition),
        testType: "api",
        apiDefinition: gen.definition,
        targetUrl: gen.definition.url,
        functionalAreaId: body.functionalAreaId ?? null,
        createdByBotId: mcpBot?.id ?? null,
        createdByUserId: mcpBot ? null : (session.user?.id ?? null),
      });
      return NextResponse.json(
        {
          status: "generated",
          summary: gen.summary,
          test: created,
          definition: gen.definition,
        },
        { status: 201 },
      );
    }

    // Suggest an application-code fix for a real_regression failure:
    // POST /api/v1/tests/:id/suggest-app-fix   Body: { buildId? }
    // Returns a recommendation only — never applies changes.
    if (resource === "tests" && slug[2] === "suggest-app-fix") {
      const testId = slug[1];
      if (!testId) {
        return NextResponse.json({ error: "testId required" }, { status: 400 });
      }
      const test = await queries.getTest(testId);
      if (!test) {
        return NextResponse.json({ error: "Test not found" }, { status: 404 });
      }
      if (test.repositoryId) {
        if (!(await verifyRepoOwnership(test.repositoryId, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      const body = (await request.json().catch(() => ({}))) as {
        buildId?: string;
      };
      const { suggestAppFix } = await import("@/lib/ai/app-fix-advisor");
      const result = await suggestAppFix({
        repositoryId: test.repositoryId!,
        testId,
        buildId: typeof body.buildId === "string" ? body.buildId : undefined,
      });
      return NextResponse.json(result);
    }

    // Approve single diff: POST /api/v1/diffs/:id/approve
    if (resource === "diffs" && id && subResource === "approve") {
      if (!(await verifyDiffOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await approveDiffCore(id, "mcp-agent");
      return NextResponse.json({ success: true });
    }

    // Reject single diff: POST /api/v1/diffs/:id/reject
    if (resource === "diffs" && id && subResource === "reject") {
      if (!(await verifyDiffOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await rejectDiffCore(id);
      return NextResponse.json({ success: true });
    }

    // Approve all diffs in a build: POST /api/v1/builds/:id/approve-all
    if (resource === "builds" && id && subResource === "approve-all") {
      if (!(await verifyBuildOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await approveAllDiffsCore(id, "mcp-agent");
      return NextResponse.json({ success: true });
    }

    // Publish a public-share link for a build: POST /api/v1/builds/:id/share
    // Body: { scopedTestId?: string } — optional, scopes share to a single test
    // Returns: { shareId, slug, url }
    if (resource === "builds" && id && subResource === "share") {
      if (!(await verifyBuildOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const body = await request.json().catch(() => ({}));
      const scopedTestId =
        typeof body?.scopedTestId === "string" ? body.scopedTestId : null;
      const { publishBuildShare } =
        await import("@/server/actions/public-shares");
      const result = await publishBuildShare(id, { scopedTestId });
      return NextResponse.json(result, { status: 201 });
    }

    // Write build demo notes: POST /api/v1/builds/:id/demo-notes
    // Body: DemoNotes payload — see schema.ts. Idempotent (upsert).
    if (resource === "builds" && id && subResource === "demo-notes") {
      if (!(await verifyBuildOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
      }
      // Minimal shape validation — refuse payloads that are obviously wrong
      // so accidental misuse fails loudly instead of writing junk JSON. We
      // accept missing arrays as empty (a summary-only note is still useful).
      const payload = {
        uxSummary: typeof body.uxSummary === "string" ? body.uxSummary : "",
        highlights: Array.isArray(body.highlights) ? body.highlights : [],
        frictionPoints: Array.isArray(body.frictionPoints)
          ? body.frictionPoints
          : [],
        testingStruggles: Array.isArray(body.testingStruggles)
          ? body.testingStruggles
          : [],
        skippedRoutes: Array.isArray(body.skippedRoutes)
          ? body.skippedRoutes
          : undefined,
        generatedAt:
          typeof body.generatedAt === "string"
            ? body.generatedAt
            : new Date().toISOString(),
        modelId: typeof body.modelId === "string" ? body.modelId : undefined,
      };
      if (
        !payload.uxSummary &&
        payload.highlights.length === 0 &&
        payload.frictionPoints.length === 0 &&
        payload.testingStruggles.length === 0
      ) {
        return NextResponse.json(
          {
            error:
              "Payload must contain at least one of uxSummary, highlights, frictionPoints, testingStruggles",
          },
          { status: 400 },
        );
      }
      await queries.upsertBuildDemoNotes(id, payload);
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    // Verify phase: POST /api/v1/verify/layer-feedback
    if (resource === "verify" && id === "layer-feedback") {
      const body = await request.json();
      const { stepComparisonId, buildId, layer, status, note } = body as {
        stepComparisonId: string;
        buildId: string;
        layer: string;
        status: string;
        note?: string;
      };
      if (!stepComparisonId || !buildId || !layer || !status) {
        return NextResponse.json(
          { error: "Missing required fields" },
          { status: 400 },
        );
      }
      if (!(await verifyBuildOwnership(buildId, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { decideLayer } = await import("@/server/actions/layer-feedback");
      const result = await decideLayer({
        stepComparisonId,
        buildId,
        layer: layer as
          | "visual"
          | "dom"
          | "a11y"
          | "network"
          | "console"
          | "url"
          | "perf"
          | "variable",
        status: status as "approved" | "rejected" | "snoozed",
        note: note ?? null,
      });
      return NextResponse.json(result);
    }

    // QuickStart agent: POST /api/v1/repos/:id/quickstart
    // Body: { emailTemplate?: string, appEmail?: string, appPassword?: string }
    if (resource === "repos" && id && subResource === "quickstart") {
      if (!(await verifyRepoOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const body = await request.json().catch(() => ({}));
      const emailTemplate =
        typeof body?.emailTemplate === "string"
          ? body.emailTemplate
          : undefined;
      const appEmail =
        typeof body?.appEmail === "string" && body.appEmail.trim().length > 0
          ? body.appEmail.trim()
          : undefined;
      const appPassword =
        typeof body?.appPassword === "string" && body.appPassword.length > 0
          ? body.appPassword
          : undefined;
      try {
        const { startQuickstart } =
          await import("@/server/actions/quickstart-agent");
        const result = await startQuickstart(
          id,
          emailTemplate || appEmail || appPassword
            ? { emailTemplate, appEmail, appPassword }
            : undefined,
        );
        return NextResponse.json(result, { status: 201 });
      } catch (err) {
        const e = err as Error & { code?: string; reason?: string };
        if (e.code === "quickstart_disabled") {
          const { gateReasonHint } = await import("@/lib/quickstart/gating");
          const reason = e.reason ?? "no_repo";
          return NextResponse.json(
            {
              error: "quickstart_disabled",
              reason,
              hint: gateReasonHint(
                reason as Parameters<typeof gateReasonHint>[0],
              ),
            },
            { status: 400 },
          );
        }
        throw err;
      }
    }

    // Import tests + functional areas: POST /api/v1/repos/:id/import
    if (resource === "repos" && id && subResource === "import") {
      if (!(await verifyRepoOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const body = await request.json();
      const { functionalAreas = [], tests: importTests = [] } = body;

      let areasCreated = 0;
      let areasUpdated = 0;
      let testsCreated = 0;
      let testsUpdated = 0;
      const errors: string[] = [];
      const nameToAreaId = new Map<string, string>();

      // Pass 1: upsert all functional areas (without parent relationships)
      for (const area of functionalAreas) {
        try {
          const existing = (await queries.getFunctionalAreasByRepo(id)).find(
            (a) => a.name.toLowerCase() === area.name.toLowerCase(),
          );
          if (existing) {
            await queries.updateFunctionalArea(existing.id, {
              orderIndex: area.orderIndex ?? existing.orderIndex,
              isRouteFolder: area.isRouteFolder ?? existing.isRouteFolder,
              agentPlan: area.agentPlan ?? existing.agentPlan,
            });
            nameToAreaId.set(area.name.toLowerCase(), existing.id);
            areasUpdated++;
          } else {
            const created = await queries.createFunctionalArea({
              repositoryId: id,
              name: area.name,
              parentId: null,
              orderIndex: area.orderIndex ?? 0,
              isRouteFolder: area.isRouteFolder ?? false,
              agentPlan: area.agentPlan ?? null,
            });
            nameToAreaId.set(area.name.toLowerCase(), created.id);
            areasCreated++;
          }
        } catch (err) {
          errors.push(`Area "${area.name}": ${(err as Error).message}`);
        }
      }

      // Pass 2: set parent relationships
      for (const area of functionalAreas) {
        if (!area.parentName) continue;
        const areaId = nameToAreaId.get(area.name.toLowerCase());
        const parentId = nameToAreaId.get(area.parentName.toLowerCase());
        if (areaId && parentId) {
          try {
            await queries.updateFunctionalArea(areaId, { parentId });
          } catch (err) {
            errors.push(
              `Area "${area.name}" parent link: ${(err as Error).message}`,
            );
          }
        }
      }

      // Pass 3: upsert tests
      const repoTests = await queries.getTestsByRepo(id);
      for (const t of importTests) {
        try {
          const functionalAreaId = t.functionalAreaName
            ? (nameToAreaId.get(t.functionalAreaName.toLowerCase()) ?? null)
            : null;

          // Find existing test by name + area
          const existing = repoTests.find(
            (et) =>
              et.name.toLowerCase() === t.name.toLowerCase() &&
              et.functionalAreaId === functionalAreaId,
          );

          const testData = {
            repositoryId: id,
            name: t.name,
            code: t.code,
            targetUrl: t.targetUrl ?? null,
            functionalAreaId,
            assertions: t.assertions ?? null,
            executionMode: t.executionMode ?? "procedural",
            setupOverrides: t.setupOverrides ?? null,
            teardownOverrides: t.teardownOverrides ?? null,
            stabilizationOverrides: t.stabilizationOverrides ?? null,
            viewportOverride: t.viewportOverride ?? null,
            diffOverrides: t.diffOverrides ?? null,
            playwrightOverrides: t.playwrightOverrides ?? null,
            requiredCapabilities: t.requiredCapabilities ?? null,
            quarantined: t.quarantined ?? false,
            isPlaceholder: t.isPlaceholder ?? false,
          };

          if (existing) {
            await queries.updateTestWithVersion(
              existing.id,
              testData,
              "migration_import",
            );
            testsUpdated++;
          } else {
            await queries.createTest(testData);
            testsCreated++;
          }
        } catch (err) {
          errors.push(`Test "${t.name}": ${(err as Error).message}`);
        }
      }

      return NextResponse.json({
        success: errors.length === 0,
        areasCreated,
        areasUpdated,
        testsCreated,
        testsUpdated,
        errors,
      });
    }

    // Create functional area: POST /api/v1/functional-areas
    if (resource === "functional-areas" && !id) {
      const body = await request.json();
      const { name, repositoryId, parentId } = body;
      if (!name) {
        return NextResponse.json({ error: "name required" }, { status: 400 });
      }
      // Verify team ownership of the target repository
      if (repositoryId) {
        if (!(await verifyRepoOwnership(repositoryId, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      const result = await queries.createFunctionalArea({
        repositoryId: repositoryId ?? null,
        name,
        parentId: parentId ?? null,
      });
      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const mapped = mapAuthError(error);
    if (mapped) return mapped;
    console.error("[API v1] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT handler
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const { resource, id, subResource } = parseSlug(slug);

  try {
    // Update repo playwright settings: PUT /api/v1/repos/:id/playwright-settings
    // Body: partial PlaywrightSettings — only whitelisted fields are upserted.
    if (resource === "repos" && id && subResource === "playwright-settings") {
      if (!(await verifyRepoOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const body = await request.json();
      const norm = normalizePlaywrightSettingsPatch(body);
      if (!norm.ok) {
        return NextResponse.json({ error: norm.error }, { status: 400 });
      }
      await queries.upsertPlaywrightSettings(id, norm.value);
      const settings = await queries.getPlaywrightSettings(id);
      return NextResponse.json(settings);
    }

    // Update repository: PUT /api/v1/repos/:id
    if (resource === "repos" && id) {
      if (!(await verifyRepoOwnership(id, session))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const body = await request.json();
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.defaultBranch !== undefined)
        updates.defaultBranch = body.defaultBranch;
      if (body.selectedBranch !== undefined)
        updates.selectedBranch = body.selectedBranch;

      // baseUrl lives in environment_configs, not repositories — route it there
      // so MCP/REST clients have a single tool to point a repo at an external app.
      let baseUrlChanged = false;
      if (body.baseUrl !== undefined) {
        const normalized = normalizeBaseUrl(body.baseUrl);
        if (normalized === null) {
          return NextResponse.json(
            { error: "baseUrl must be a valid http(s) URL" },
            { status: 400 },
          );
        }
        await queries.upsertEnvironmentConfig(id, { baseUrl: normalized });
        baseUrlChanged = true;
      }

      if (Object.keys(updates).length === 0 && !baseUrlChanged) {
        return NextResponse.json(
          { error: "No fields to update" },
          { status: 400 },
        );
      }
      if (Object.keys(updates).length > 0) {
        await queries.updateRepository(id, updates);
      }
      const updated = await queries.getRepository(id);
      const env = await queries.getEnvironmentConfig(id);
      return NextResponse.json({ ...updated, baseUrl: env?.baseUrl ?? null });
    }

    // Update functional area: PUT /api/v1/functional-areas/:id
    if (resource === "functional-areas" && id) {
      const area = await queries.getFunctionalArea(id);
      if (!area) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (area.repositoryId) {
        if (!(await verifyRepoOwnership(area.repositoryId, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      const body = await request.json();
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.description !== undefined)
        updates.description = body.description;
      if (body.parentId !== undefined) updates.parentId = body.parentId;
      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: "No fields to update" },
          { status: 400 },
        );
      }
      await queries.updateFunctionalArea(id, updates);
      const updated = await queries.getFunctionalArea(id);
      return NextResponse.json(updated);
    }

    // Update setup script: PUT /api/v1/setup-scripts/:id
    if (resource === "setup-scripts" && id) {
      const { ok, script } = await verifySetupScriptOwnership(id, session);
      if (!ok || !script) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const body = await request.json();
      const updates: {
        name?: string;
        type?: "playwright" | "api";
        code?: string;
        description?: string;
      } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim()) {
          return NextResponse.json(
            { error: "name must be a non-empty string" },
            { status: 400 },
          );
        }
        updates.name = body.name.trim();
      }
      if (body.type !== undefined) {
        if (body.type !== "playwright" && body.type !== "api") {
          return NextResponse.json(
            { error: 'type must be "playwright" or "api"' },
            { status: 400 },
          );
        }
        updates.type = body.type;
      }
      if (body.code !== undefined) {
        if (typeof body.code !== "string") {
          return NextResponse.json(
            { error: "code must be a string" },
            { status: 400 },
          );
        }
        if (
          Buffer.byteLength(body.code, "utf8") > MAX_SETUP_SCRIPT_CODE_BYTES
        ) {
          return NextResponse.json(
            { error: `code exceeds ${MAX_SETUP_SCRIPT_CODE_BYTES} bytes` },
            { status: 413 },
          );
        }
        updates.code = body.code;
      }
      if (body.description !== undefined) {
        if (body.description !== null && typeof body.description !== "string") {
          return NextResponse.json(
            { error: "description must be a string or null" },
            { status: 400 },
          );
        }
        updates.description = body.description ?? undefined;
      }
      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: "No fields to update" },
          { status: 400 },
        );
      }
      const effectiveType = updates.type ?? script.type;
      const effectiveCode = updates.code ?? script.code;
      if (effectiveType === "api" && updates.code !== undefined) {
        const { validateApiScript } = await import("@/lib/setup/api-seeder");
        const validation = validateApiScript(effectiveCode);
        if (!validation.valid) {
          return NextResponse.json(
            { error: `Invalid API script: ${validation.error}` },
            { status: 400 },
          );
        }
      }
      await queries.updateSetupScript(id, updates);
      const updated = await queries.getSetupScript(id);
      return NextResponse.json(updated);
    }

    // Update test: PUT /api/v1/tests/:id
    if (resource === "tests" && id) {
      const test = await queries.getTest(id);
      if (!test) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (test.repositoryId) {
        const testRepo = await queries.getRepository(test.repositoryId);
        if (!testRepo || testRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }

      const body = await request.json();
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.code !== undefined) updates.code = body.code;
      if (body.targetUrl !== undefined) updates.targetUrl = body.targetUrl;
      if (body.functionalAreaId !== undefined)
        updates.functionalAreaId = body.functionalAreaId;
      // E1: api tests are edited via their definition; keep the code column (a
      // readable, credential-free JSON rendering) in sync unless code was set
      // explicitly. The column is snapshotted into test_versions, so never
      // write raw auth material into it.
      if (body.apiDefinition !== undefined) {
        const def = body.apiDefinition;
        if (
          def === null ||
          typeof def !== "object" ||
          Array.isArray(def) ||
          !def.method ||
          !def.url ||
          !Array.isArray(def.assertions)
        ) {
          return NextResponse.json(
            {
              error:
                "apiDefinition must be an object with method, url, and assertions[]",
            },
            { status: 400 },
          );
        }
        updates.apiDefinition = def;
        if (body.code === undefined) {
          const { renderApiDefinitionForCode } =
            await import("@/lib/api-test/redact");
          updates.code = renderApiDefinitionForCode(def);
        }
        if (body.targetUrl === undefined) updates.targetUrl = def.url;
      }
      if (body.quarantined !== undefined) {
        if (typeof body.quarantined !== "boolean") {
          return NextResponse.json(
            { error: "quarantined must be a boolean" },
            { status: 400 },
          );
        }
        updates.quarantined = body.quarantined;
      }
      if (body.executionMode !== undefined) {
        if (
          body.executionMode !== "procedural" &&
          body.executionMode !== "agent"
        ) {
          return NextResponse.json(
            { error: 'executionMode must be "procedural" | "agent"' },
            { status: 400 },
          );
        }
        updates.executionMode = body.executionMode;
      }
      if (body.viewportOverride !== undefined) {
        if (body.viewportOverride === null) {
          updates.viewportOverride = null;
        } else {
          const vp = body.viewportOverride;
          if (
            typeof vp !== "object" ||
            Array.isArray(vp) ||
            typeof vp.width !== "number" ||
            typeof vp.height !== "number" ||
            vp.width <= 0 ||
            vp.height <= 0
          ) {
            return NextResponse.json(
              {
                error:
                  "viewportOverride must be { width, height } with positive numbers, or null",
              },
              { status: 400 },
            );
          }
          updates.viewportOverride = {
            width: Math.floor(vp.width),
            height: Math.floor(vp.height),
          };
        }
      }
      if (body.playwrightOverrides !== undefined) {
        const norm = normalizePlaywrightOverrides(body.playwrightOverrides);
        if (!norm.ok) {
          return NextResponse.json(
            { error: `playwrightOverrides: ${norm.error}` },
            { status: 400 },
          );
        }
        updates.playwrightOverrides = norm.value;
      }
      if (body.diffOverrides !== undefined) {
        if (
          body.diffOverrides !== null &&
          (typeof body.diffOverrides !== "object" ||
            Array.isArray(body.diffOverrides))
        ) {
          return NextResponse.json(
            { error: "diffOverrides must be an object or null" },
            { status: 400 },
          );
        }
        updates.diffOverrides = body.diffOverrides;
      }
      if (body.stabilizationOverrides !== undefined) {
        if (
          body.stabilizationOverrides !== null &&
          (typeof body.stabilizationOverrides !== "object" ||
            Array.isArray(body.stabilizationOverrides))
        ) {
          return NextResponse.json(
            { error: "stabilizationOverrides must be an object or null" },
            { status: 400 },
          );
        }
        updates.stabilizationOverrides = body.stabilizationOverrides;
      }

      // Setup wiring: accept setupTestId / setupScriptId / setupOverrides /
      // teardownOverrides. setupTestId and setupScriptId are mutually exclusive
      // — the DB precedence is "test > script", so we mirror that: if both are
      // supplied (non-null) we reject. Each referenced ID must live in the
      // same repo as the test being updated, otherwise a token holder could
      // chain in setup from a different repo (still same team, but wrong
      // wiring) or sniff for ID existence cross-tenant.
      const setupTestIdProvided = Object.prototype.hasOwnProperty.call(
        body,
        "setupTestId",
      );
      const setupScriptIdProvided = Object.prototype.hasOwnProperty.call(
        body,
        "setupScriptId",
      );
      if (setupTestIdProvided || setupScriptIdProvided) {
        const nextSetupTestId = setupTestIdProvided
          ? body.setupTestId === null || body.setupTestId === ""
            ? null
            : body.setupTestId
          : (test.setupTestId ?? null);
        const nextSetupScriptId = setupScriptIdProvided
          ? body.setupScriptId === null || body.setupScriptId === ""
            ? null
            : body.setupScriptId
          : (test.setupScriptId ?? null);
        if (nextSetupTestId && nextSetupScriptId) {
          return NextResponse.json(
            { error: "setupTestId and setupScriptId are mutually exclusive" },
            { status: 400 },
          );
        }
        if (nextSetupTestId) {
          if (nextSetupTestId === id) {
            return NextResponse.json(
              { error: "Test cannot reference itself as setup" },
              { status: 400 },
            );
          }
          const setupTest = await queries.getTest(nextSetupTestId);
          if (!setupTest || setupTest.repositoryId !== test.repositoryId) {
            return NextResponse.json(
              { error: "Invalid setupTestId" },
              { status: 400 },
            );
          }
        }
        if (nextSetupScriptId) {
          const script = await queries.getSetupScript(nextSetupScriptId);
          if (!script || script.repositoryId !== test.repositoryId) {
            return NextResponse.json(
              { error: "Invalid setupScriptId" },
              { status: 400 },
            );
          }
        }
        if (setupTestIdProvided) updates.setupTestId = nextSetupTestId;
        if (setupScriptIdProvided) updates.setupScriptId = nextSetupScriptId;
      }

      // setupOverrides / teardownOverrides — validate any step ids inside the
      // extraSteps list against the same repo. We accept `null` to clear.
      for (const key of ["setupOverrides", "teardownOverrides"] as const) {
        if (body[key] === undefined) continue;
        if (body[key] === null) {
          updates[key] = null;
          continue;
        }
        const v = body[key];
        if (typeof v !== "object" || Array.isArray(v)) {
          return NextResponse.json(
            { error: `${key} must be an object or null` },
            { status: 400 },
          );
        }
        const skipped = Array.isArray(v.skippedDefaultStepIds)
          ? v.skippedDefaultStepIds
          : [];
        const extras = Array.isArray(v.extraSteps) ? v.extraSteps : [];
        const normalizedExtras: Array<{
          stepType: "test" | "script" | "storage_state";
          testId?: string | null;
          scriptId?: string | null;
          storageStateId?: string | null;
        }> = [];
        for (const step of extras) {
          if (!step || typeof step !== "object") {
            return NextResponse.json(
              { error: `${key}.extraSteps entries must be objects` },
              { status: 400 },
            );
          }
          const stepType = step.stepType;
          if (
            stepType !== "test" &&
            stepType !== "script" &&
            stepType !== "storage_state"
          ) {
            return NextResponse.json(
              {
                error: `${key}.extraSteps stepType must be 'test' | 'script' | 'storage_state'`,
              },
              { status: 400 },
            );
          }
          if (stepType === "test") {
            if (!step.testId || typeof step.testId !== "string") {
              return NextResponse.json(
                { error: `${key} test step requires testId` },
                { status: 400 },
              );
            }
            const refTest = await queries.getTest(step.testId);
            if (!refTest || refTest.repositoryId !== test.repositoryId) {
              return NextResponse.json(
                { error: `${key} testId ${step.testId} not in this repo` },
                { status: 400 },
              );
            }
            normalizedExtras.push({
              stepType,
              testId: step.testId,
              scriptId: null,
              storageStateId: null,
            });
          } else if (stepType === "script") {
            if (!step.scriptId || typeof step.scriptId !== "string") {
              return NextResponse.json(
                { error: `${key} script step requires scriptId` },
                { status: 400 },
              );
            }
            const refScript = await queries.getSetupScript(step.scriptId);
            if (!refScript || refScript.repositoryId !== test.repositoryId) {
              return NextResponse.json(
                { error: `${key} scriptId ${step.scriptId} not in this repo` },
                { status: 400 },
              );
            }
            normalizedExtras.push({
              stepType,
              testId: null,
              scriptId: step.scriptId,
              storageStateId: null,
            });
          } else {
            if (
              !step.storageStateId ||
              typeof step.storageStateId !== "string"
            ) {
              return NextResponse.json(
                { error: `${key} storage_state step requires storageStateId` },
                { status: 400 },
              );
            }
            const refState = await queries.getStorageState(step.storageStateId);
            if (!refState || refState.repositoryId !== test.repositoryId) {
              return NextResponse.json(
                {
                  error: `${key} storageStateId ${step.storageStateId} not in this repo`,
                },
                { status: 400 },
              );
            }
            normalizedExtras.push({
              stepType,
              testId: null,
              scriptId: null,
              storageStateId: step.storageStateId,
            });
          }
        }
        updates[key] = {
          skippedDefaultStepIds: skipped.filter(
            (s: unknown): s is string => typeof s === "string",
          ),
          extraSteps: normalizedExtras,
        };
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: "No fields to update" },
          { status: 400 },
        );
      }

      await queries.updateTestWithVersion(id, updates, "mcp_edit");

      // Award MCP bot points when a placeholder test gets real code via API
      if (updates.code && test.isPlaceholder && test.repositoryId) {
        const repo = await queries.getRepository(test.repositoryId);
        if (repo?.teamId) {
          const mcpBot = await queries.getBotByKind(repo.teamId, "mcp_server");
          if (mcpBot) {
            // Stamp bot as creator for future regression/flake attribution
            queries
              .updateTest(id, { createdByBotId: mcpBot.id })
              .catch(() => {});
            awardScore({
              teamId: repo.teamId,
              kind: "test_created",
              actor: { kind: "bot", id: mcpBot.id },
              sourceType: "test",
              sourceId: id,
            }).catch(() => {});
          }
        }
      }

      const updated = await queries.getTest(id);
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const mapped = mapAuthError(error);
    if (mapped) return mapped;
    console.error("[API v1] PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE handler
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const { resource, id } = parseSlug(slug);

  try {
    // Revoke public share: DELETE /api/v1/shares/:id
    if (resource === "shares" && id) {
      const { ok } = await verifyShareOwnership(id, session);
      if (!ok) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await queries.revokePublicShareById(id);
      return NextResponse.json({ success: true });
    }

    // Cancel QuickStart agent session: DELETE /api/v1/quickstart/:sessionId
    if (resource === "quickstart" && id) {
      const sessionRow = await queries.getAgentSession(id);
      if (!sessionRow || sessionRow.kind !== "quickstart") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (sessionRow.teamId && sessionRow.teamId !== session.team?.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { cancelQuickstart } =
        await import("@/server/actions/quickstart-agent");
      const result = await cancelQuickstart(id);
      return NextResponse.json(result);
    }

    // Delete storage state: DELETE /api/v1/storage-states/:id
    if (resource === "storage-states" && id) {
      const { ok } = await verifyStorageStateOwnership(id, session);
      if (!ok) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await queries.deleteStorageState(id);
      return NextResponse.json({ success: true });
    }

    // Delete setup script: DELETE /api/v1/setup-scripts/:id
    if (resource === "setup-scripts" && id) {
      const { ok } = await verifySetupScriptOwnership(id, session);
      if (!ok) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Refuse delete if the script is still wired into a test as setup —
      // mirrors the server-action guard so we don't orphan setupScriptId
      // references in the tests table.
      const inUse = await queries.getTestsUsingSetupScript(id);
      if (inUse.length > 0) {
        return NextResponse.json(
          {
            error: `Cannot delete: script is used by ${inUse.length} test(s)`,
            tests: inUse.map((t) => ({ id: t.id, name: t.name })),
          },
          { status: 409 },
        );
      }
      await queries.deleteSetupScript(id);
      return NextResponse.json({ success: true });
    }

    // Soft-delete functional area: DELETE /api/v1/functional-areas/:id
    if (resource === "functional-areas" && id) {
      const area = await queries.getFunctionalArea(id);
      if (!area) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (area.repositoryId) {
        if (!(await verifyRepoOwnership(area.repositoryId, session))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }
      await queries.deleteFunctionalArea(id);
      return NextResponse.json({ success: true });
    }

    // Soft-delete test: DELETE /api/v1/tests/:id
    if (resource === "tests" && id) {
      const test = await queries.getTest(id);
      if (!test) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (test.repositoryId) {
        const testRepo = await queries.getRepository(test.repositoryId);
        if (!testRepo || testRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
      }

      await queries.softDeleteTest(id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const mapped = mapAuthError(error);
    if (mapped) return mapped;
    console.error("[API v1] DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Helper to enrich tests with last run status
async function enrichTestsWithStatus(
  tests: {
    id: string;
    name: string;
    functionalAreaId: string | null;
    targetUrl: string | null;
    code: string;
  }[],
) {
  const enriched = await Promise.all(
    tests.map(async (test) => {
      // Get most recent test result for this test
      const results = await queries.getTestResultsByTest(test.id);
      const latestResult = results[0];

      return {
        id: test.id,
        name: test.name,
        functionalAreaId: test.functionalAreaId,
        targetUrl: test.targetUrl,
        code: test.code,
        lastRunStatus: latestResult?.status || null,
        lastRunAt: latestResult
          ? (
              await queries.getTestRun(latestResult.testRunId!)
            )?.startedAt?.toISOString()
          : null,
      };
    }),
  );

  return enriched;
}
