import "server-only";

import { and, eq, gt } from "drizzle-orm";
import type {
  FunctionalAreaRef,
  GuardedFetchOptions,
  GuardedFetchResult,
  PlaywrightRecordingSettings,
  RecorderHost,
  RecordingEvent,
  RecordingSession,
  ResolvedSetupStep,
  SaveRecordedTestInput,
  SetupChainStep,
  UpdateRerecordedTestInput,
} from "@lastest/plugin-recorder/host";
import type { SelectorConfig } from "@lastest/plugin-recorder/types";

import { db } from "@/lib/db";
import type { DomSnapshotData } from "@/lib/db/schema";
import {
  embeddedSessions,
  remoteRecordingEvents,
  runners,
} from "@/lib/db/schema";
import { requireCapability, requireRepoCapability } from "@/lib/auth";
import { requireTestOwnership } from "@/lib/auth/ownership";
import * as queries from "@/lib/db/queries";
import { extractText } from "@/lib/playwright/ocr";
import { ocrSleep, ocrWarmup } from "@/lib/ocr";
import {
  claimOrProvisionPoolEB,
  releasePoolEB,
} from "@/server/actions/embedded-sessions";
import {
  safeOutboundFetch,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import {
  clearRemoteRecordingSession,
  completeRemoteRecordingSession,
  createRemoteRecordingSession,
  getRemoteRecordingEvents,
  getRemoteRecordingSession,
  queueCommandToDB,
} from "@/app/api/ws/runner/route";

/**
 * The app's fill for `RecorderHost`. `plugins/recorder/src/host.ts` explains
 * why each group of methods exists; this file is where each does more than
 * pass a call through.
 *
 * **The runner-channel session group is a straight wrap** of
 * `src/app/api/ws/runner/route.ts`'s in-memory map plus the core
 * `remote_recording_events` table — no behaviour change, just a narrower
 * type at the boundary (`RecordingSession`/`RecordingEvent` instead of the
 * route's own `RemoteRecordingSession`/`RemoteRecordingEvent`, which are
 * structurally identical; a `satisfies`-shaped cast documents that rather
 * than hides it).
 *
 * **`resolveSetupSteps` is where the setup-chain precedence moved.** It used
 * to live in `src/server/actions/recording.ts`'s `startRecording`, reading
 * five different query functions inline. It is unchanged logic, moved
 * verbatim — see the inline comments for the four-level precedence.
 */

function toRecordingSession(
  s: NonNullable<ReturnType<typeof getRemoteRecordingSession>>,
): RecordingSession {
  return s as unknown as RecordingSession;
}

export const appRecorderHost: RecorderHost = {
  async requireRecordingAccess(): Promise<void> {
    await requireCapability("recording:write");
  },

  // ── Runner-channel session ────────────────────────────────────────────

  async claimRunner() {
    const claimed = await claimOrProvisionPoolEB();
    if (!claimed) return null;
    return { runnerId: claimed.runnerId };
  },

  async releaseRunner(runnerId: string) {
    await releasePoolEB(runnerId);
  },

  async sendCommand(runnerId, message) {
    await queueCommandToDB(runnerId, message);
  },

  createSession(input) {
    createRemoteRecordingSession(
      input.sessionId,
      input.runnerId,
      input.repositoryId,
      input.targetUrl,
      input.selectorPriority,
    );
  },

  getSession(repositoryId) {
    const session = getRemoteRecordingSession(repositoryId);
    return session ? toRecordingSession(session) : null;
  },

  async clearSession(repositoryId) {
    await clearRemoteRecordingSession(repositoryId);
  },

  completeSession(repositoryId, generatedCode) {
    completeRemoteRecordingSession(repositoryId, generatedCode);
  },

  async getEvents(repositoryId, sinceSequence) {
    const events = await getRemoteRecordingEvents(repositoryId, sinceSequence);
    return events as unknown as RecordingEvent[];
  },

  async updateEventData(sessionId, events) {
    if (events.length === 0) return;
    try {
      await Promise.all(
        events.map((event) =>
          db
            .update(remoteRecordingEvents)
            .set({ data: event.data })
            .where(
              and(
                eq(remoteRecordingEvents.sessionId, sessionId),
                eq(remoteRecordingEvents.sequence, event.sequence),
              ),
            ),
        ),
      );
    } catch (err) {
      console.warn(
        `[Recording] Failed to persist OCR selector updates for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  async checkRunnerStillBusy(runnerId, sessionId, sinceSequence) {
    const [runnerRow] = await db
      .select({
        runnerStatus: runners.status,
        sessionStatus: embeddedSessions.status,
      })
      .from(runners)
      .leftJoin(embeddedSessions, eq(embeddedSessions.runnerId, runners.id))
      .where(eq(runners.id, runnerId))
      .limit(1);

    const stillBusy =
      !!runnerRow &&
      runnerRow.runnerStatus === "busy" &&
      (runnerRow.sessionStatus === null || runnerRow.sessionStatus === "busy");

    if (!stillBusy || !sessionId) return { stillBusy, events: [] };

    const where =
      sinceSequence !== undefined
        ? and(
            eq(remoteRecordingEvents.sessionId, sessionId),
            gt(remoteRecordingEvents.sequence, sinceSequence),
          )
        : eq(remoteRecordingEvents.sessionId, sessionId);
    const rows = await db
      .select()
      .from(remoteRecordingEvents)
      .where(where)
      .orderBy(remoteRecordingEvents.sequence);
    const events: RecordingEvent[] = rows.map((r) => ({
      type: r.type,
      timestamp: r.timestamp,
      sequence: r.sequence,
      status: r.status as "preview" | "committed",
      verification: (r.verification ??
        undefined) as RecordingEvent["verification"],
      data: (r.data ?? {}) as Record<string, unknown>,
    }));
    return { stillBusy, events };
  },

  // ── OCR ────────────────────────────────────────────────────────────────

  ocrWarmup() {
    ocrWarmup();
  },

  async ocrSleep() {
    await ocrSleep();
  },

  async extractOcrText(imageBuffer: Buffer) {
    return extractText(imageBuffer);
  },

  // ── Data ─────────────────────────────────────────────────────────────

  async getPlaywrightSettings(
    repositoryId,
  ): Promise<PlaywrightRecordingSettings> {
    const settings = await queries.getPlaywrightSettings(repositoryId);
    return {
      selectorPriority: settings.selectorPriority as SelectorConfig[],
      viewportWidth: settings.viewportWidth ?? null,
      viewportHeight: settings.viewportHeight ?? null,
      browser: settings.browser ?? null,
      pointerGestures: settings.pointerGestures ?? null,
      cursorFPS: settings.cursorFPS ?? null,
      selectorTimeoutMs: settings.selectorTimeoutMs ?? null,
      customAttributeName: settings.customAttributeName ?? null,
    };
  },

  async resolveSetupSteps(input): Promise<ResolvedSetupStep[] | undefined> {
    const stepsToResolve: SetupChainStep[] = [];

    if (input.steps?.length) {
      stepsToResolve.push(...input.steps);
    } else if (input.rerecordTestId) {
      // Re-record: resolve the existing test's chain (defaults + overrides, or legacy).
      const existing = await queries.getTest(input.rerecordTestId);
      if (existing?.repositoryId) {
        const defaults = await queries.getDefaultSetupSteps(
          existing.repositoryId,
        );
        if (defaults.length > 0) {
          const overrides = existing.setupOverrides;
          const skipped = new Set(overrides?.skippedDefaultStepIds ?? []);
          for (const d of defaults) {
            if (skipped.has(d.id)) continue;
            stepsToResolve.push({
              stepType: d.stepType as SetupChainStep["stepType"],
              testId: d.testId,
              scriptId: d.scriptId,
              storageStateId: d.storageStateId,
            });
          }
          for (const e of overrides?.extraSteps ?? []) {
            stepsToResolve.push({
              stepType: e.stepType as SetupChainStep["stepType"],
              testId: e.testId ?? null,
              scriptId: e.scriptId ?? null,
              storageStateId:
                (e as { storageStateId?: string | null }).storageStateId ??
                null,
            });
          }
        } else if (existing.setupTestId) {
          stepsToResolve.push({
            stepType: "test",
            testId: existing.setupTestId,
          });
        } else if (existing.setupScriptId) {
          stepsToResolve.push({
            stepType: "script",
            scriptId: existing.setupScriptId,
          });
        }
      }
    } else if (input.repositoryId) {
      // Fresh recording: pick up whatever the repo declares as the default chain.
      const defaults = await queries.getDefaultSetupSteps(input.repositoryId);
      if (defaults.length > 0) {
        for (const d of defaults) {
          stepsToResolve.push({
            stepType: d.stepType as SetupChainStep["stepType"],
            testId: d.testId,
            scriptId: d.scriptId,
            storageStateId: d.storageStateId,
          });
        }
      } else {
        const repo = await queries.getRepository(input.repositoryId);
        if (repo?.defaultSetupTestId) {
          stepsToResolve.push({
            stepType: "test",
            testId: repo.defaultSetupTestId,
          });
        } else if (repo?.defaultSetupScriptId) {
          stepsToResolve.push({
            stepType: "script",
            scriptId: repo.defaultSetupScriptId,
          });
        }
      }
    }

    if (stepsToResolve.length === 0) return undefined;

    const resolved: ResolvedSetupStep[] = [];
    for (const step of stepsToResolve) {
      if (step.stepType === "storage_state") {
        if (!step.storageStateId) continue;
        const ss = await queries.getStorageState(step.storageStateId);
        if (!ss?.storageStateJson) continue;
        try {
          const parsed = JSON.parse(ss.storageStateJson);
          const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
          if (cookies.length === 0) continue;
          const code = `export async function setup(page) { await page.context().addCookies(${JSON.stringify(cookies)}); }`;
          resolved.push({ code, codeHash: "" });
        } catch (err) {
          console.warn(
            `[Recording] Failed to parse storage state ${step.storageStateId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        continue;
      }
      const id = step.stepType === "test" ? step.testId : step.scriptId;
      if (!id) continue;
      const record =
        step.stepType === "test"
          ? await queries.getTest(id)
          : await queries.getSetupScript(id);
      if (record?.code) {
        const hash = (record as Record<string, unknown>).codeHash;
        resolved.push({
          code: record.code,
          codeHash: typeof hash === "string" ? hash : "",
        });
      }
    }
    return resolved.length > 0 ? resolved : undefined;
  },

  async getOrCreateFunctionalArea(name: string): Promise<FunctionalAreaRef> {
    const areas = await queries.getFunctionalAreas();
    const existing = areas.find(
      (a) => a.name.toLowerCase() === name.toLowerCase(),
    );
    const area = existing ?? (await queries.createFunctionalArea({ name }));
    return {
      id: area.id,
      name: area.name,
      repositoryId: area.repositoryId ?? null,
      parentId: area.parentId ?? null,
      isRouteFolder: area.isRouteFolder ?? null,
      orderIndex: area.orderIndex ?? null,
      agentPlan: area.agentPlan ?? null,
      planGeneratedAt: area.planGeneratedAt ?? null,
      planSnapshot: area.planSnapshot ?? null,
      deletedAt: area.deletedAt ?? null,
    };
  },

  // ── Guarded writes ───────────────────────────────────────────────────

  async saveRecordedTest(input: SaveRecordedTestInput) {
    if (input.repositoryId) {
      await requireRepoCapability(input.repositoryId, "tests:write");
    } else {
      await requireCapability("tests:write");
    }

    const test = await queries.createTest(
      {
        name: input.name,
        functionalAreaId: input.functionalAreaId,
        targetUrl: input.targetUrl,
        code: input.code,
        repositoryId: input.repositoryId ?? null,
        requiredCapabilities: input.requiredCapabilities ?? undefined,
        // The plugin treats `domSnapshot` opaquely (its own type is `unknown`);
        // the app knows the real shape.
        domSnapshot:
          (input.domSnapshot as DomSnapshotData | undefined) ?? undefined,
      },
      null,
      input.viewportWidth
        ? { width: input.viewportWidth, height: input.viewportHeight }
        : null,
    );

    // Auto-enable Playwright settings for detected capabilities.
    if (input.requiredCapabilities && input.repositoryId) {
      const updates: Record<string, boolean> = {};
      if (input.requiredCapabilities.clipboard)
        updates.grantClipboardAccess = true;
      if (input.requiredCapabilities.networkInterception)
        updates.enableNetworkInterception = true;
      if (input.requiredCapabilities.downloads) updates.acceptDownloads = true;
      if (Object.keys(updates).length > 0) {
        await queries.upsertPlaywrightSettings(input.repositoryId, updates);
      }
    }

    // Update environment config baseUrl from the recording target URL. Skip
    // when there's no repo: env config is repository-scoped only.
    if (input.targetUrl && input.repositoryId) {
      try {
        const origin = new URL(input.targetUrl).origin;
        await queries.upsertEnvironmentConfig(input.repositoryId, {
          baseUrl: origin,
        });
      } catch {
        // Invalid URL — skip baseUrl update.
      }
    }

    // Persist setup overrides (skipped defaults and/or extra steps).
    const hasSkipped =
      input.skippedDefaultStepIds && input.skippedDefaultStepIds.length > 0;
    const hasExtra = input.extraSetupSteps && input.extraSetupSteps.length > 0;
    if (hasSkipped || hasExtra) {
      await queries.updateTestSetupOverrides(test.id, {
        skippedDefaultStepIds: input.skippedDefaultStepIds ?? [],
        extraSteps: (input.extraSetupSteps ?? []).map((s) => ({
          stepType: s.stepType,
          testId: s.testId ?? null,
          scriptId: s.scriptId ?? null,
        })),
      });
    }

    return { id: test.id };
  },

  async updateRerecordedTest(input: UpdateRerecordedTestInput) {
    await requireTestOwnership(input.testId);

    const { getCurrentBranchForRepo } = await import("@/lib/git-utils");
    const test = await queries.getTest(input.testId);
    const branch = test
      ? await getCurrentBranchForRepo(test.repositoryId)
      : null;

    const viewport = input.viewportWidth
      ? { width: input.viewportWidth, height: input.viewportHeight }
      : null;

    await queries.updateTestWithVersion(
      input.testId,
      {
        code: input.code,
        ...(input.targetUrl && { targetUrl: input.targetUrl }),
      },
      "rerecorded",
      branch ?? undefined,
      viewport,
    );

    // Clear placeholder flag after re-recording.
    await queries.updateTest(input.testId, { isPlaceholder: false });

    return { id: input.testId };
  },

  // ── Security boundary ────────────────────────────────────────────────

  async fetchGuarded(
    url: string,
    opts: GuardedFetchOptions,
  ): Promise<GuardedFetchResult> {
    try {
      const res = await safeOutboundFetch(
        url,
        {
          signal: opts.timeoutMs
            ? AbortSignal.timeout(opts.timeoutMs)
            : undefined,
          headers: opts.headers,
        },
        { maxRedirects: opts.maxRedirects ?? 5 },
      );
      if (!res.ok) {
        return {
          ok: false,
          error: `Could not load page (HTTP ${res.status}). Check the URL and try again.`,
        };
      }
      return {
        ok: true,
        status: res.status,
        contentType: res.headers.get("content-type"),
        text: await res.text(),
      };
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        return { ok: false, blocked: true, error: err.message };
      }
      const reason =
        err instanceof Error && err.name === "TimeoutError"
          ? "timed out"
          : "failed";
      return {
        ok: false,
        error: `Request to the URL ${reason}. The page may be unreachable from the server.`,
      };
    }
  },
};
