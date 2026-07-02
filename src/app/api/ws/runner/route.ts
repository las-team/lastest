/**
 * WebSocket API Endpoint for Runner Connections
 *
 * Note: Next.js App Router doesn't natively support WebSocket upgrades.
 * This endpoint provides a fallback HTTP API for runner communication.
 *
 * Command queue and results are persisted in SQLite (runner_commands /
 * runner_command_results tables).  In-memory Maps are used only for
 * duplicate-session detection and real-time recording sessions.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  validateRunnerToken,
  updateRunnerStatus,
} from "@/server/actions/runners";
import type {
  Message,
  HeartbeatMessage,
  TestResultResponse,
  SetupResultResponse,
  ScreenshotUploadResponse,
  ScreenshotTextUploadResponse,
  RecordingEventResponse,
  RecordingStoppedResponse,
  ErrorResponse,
  StepEventResponse,
  CommandAckResponse,
} from "@/lib/ws/protocol";
import { recordStepEvent } from "@/lib/ws/step-state";
import {
  waitForCommandQueued,
  notifyCommandQueued,
} from "@/lib/ws/runner-events";
import fs from "fs/promises";
import path from "path";
import { STORAGE_DIRS } from "@/lib/storage/paths";
import { assertWithinDir, UnsafePathError } from "@/lib/security/safe-path";
import {
  dispatchPendingCommands,
  ackDispatchedCommand,
  completeRunnerCommand,
  insertCommandResult,
  createRunnerCommand,
  cancelPendingCommandsByTestRun,
  recordSelectorOutcomes,
  upsertStepEventBeacon,
} from "@/lib/db/queries";
// activeRunnerSessions + the cleanup interval moved to `@/lib/eb/cleanup-loop`
// so `instrumentation.ts` can boot the loop without depending on /api/ws/runner
// traffic. The route still calls `startCleanupLoop()` defensively for paths
// that bypass instrumentation (e.g. `next dev` without instrumentation).
import { activeRunnerSessions, startCleanupLoop } from "@/lib/eb/cleanup-loop";

// ============================================
// Security Validation Functions
// ============================================

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10MB limit

/**
 * Sanitize filename to prevent path traversal attacks.
 * Only allows alphanumeric characters, dots, hyphens, and underscores.
 * Must end with valid image extension.
 */
function sanitizeFilename(filename: string): string {
  // Remove null bytes
  let safe = filename.replace(/\0/g, "");
  // Extract only the filename (no path components)
  safe = safe.split(/[/\\]/).pop() || "";
  // Remove any .. sequences
  safe = safe.replace(/\.\./g, "");
  // Only allow safe characters
  safe = safe.replace(/[^a-zA-Z0-9_.-]/g, "");
  // Validate extension and length
  if (!/\.(png|jpg|jpeg)$/i.test(safe) || safe.length > 255 || !safe) {
    throw new Error("Invalid filename");
  }
  return safe;
}

/**
 * Sanitize a video filename. Same rules as `sanitizeFilename` but the only
 * allowed extensions are `.webm` and `.mp4`.
 */
function sanitizeVideoFilename(filename: string): string {
  let safe = filename.replace(/\0/g, "");
  safe = safe.split(/[/\\]/).pop() || "";
  safe = safe.replace(/\.\./g, "");
  safe = safe.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!/\.(webm|mp4)$/i.test(safe) || safe.length > 255 || !safe) {
    throw new Error("Invalid video filename");
  }
  return safe;
}

/**
 * Validate repository ID format (UUID only).
 */
function validateRepositoryId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new Error("Invalid repository ID format");
  }
  return id;
}

/**
 * Validate screenshot size to prevent DoS via massive uploads.
 */
function validateScreenshotSize(base64Data: string): void {
  // Base64 encoded data is ~4/3 the size of binary
  const estimatedBytes = (base64Data.length * 3) / 4;
  if (estimatedBytes > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      `Screenshot exceeds ${MAX_SCREENSHOT_BYTES / (1024 * 1024)}MB limit`,
    );
  }
}

const MAX_SCREENSHOT_TEXT_BYTES = 512 * 1024; // 512KB ceiling — capture-side caps at 200KB; this leaves headroom

/**
 * Sanitize a `.txt` companion filename. Same rules as the screenshot filename
 * but the only allowed extension is `.txt`.
 */
function sanitizeTextFilename(filename: string): string {
  let safe = filename.replace(/\0/g, "");
  safe = safe.split(/[/\\]/).pop() || "";
  safe = safe.replace(/\.\./g, "");
  safe = safe.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!/\.txt$/i.test(safe) || safe.length > 255 || !safe) {
    throw new Error("Invalid text filename");
  }
  return safe;
}

function validateScreenshotTextSize(base64Data: string): void {
  const estimatedBytes = (base64Data.length * 3) / 4;
  if (estimatedBytes > MAX_SCREENSHOT_TEXT_BYTES) {
    throw new Error(
      `Screenshot text exceeds ${MAX_SCREENSHOT_TEXT_BYTES / 1024}KB limit`,
    );
  }
}

function ensureInitialized() {
  startCleanupLoop();
}

/**
 * POST /api/ws/runner
 * Polling endpoint for runners when WebSocket is not available
 * Runners poll this endpoint to receive commands and send responses
 */
export async function POST(request: NextRequest) {
  ensureInitialized();
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing authorization" },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7);
    const runner = await validateRunnerToken(token);

    if (!runner) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Validate session ID for heartbeat requests
    const sessionId = request.headers.get("x-session-id");
    const activeSession = activeRunnerSessions.get(runner.id);

    if (activeSession && sessionId !== activeSession.sessionId) {
      return NextResponse.json(
        {
          error:
            "Session conflict: another runner instance is connected with this token",
        },
        { status: 409 },
      );
    }

    // Update last poll timestamp if session is valid
    if (activeSession && sessionId === activeSession.sessionId) {
      activeSession.lastPoll = Date.now();
    }

    const body = await request.json();
    const message = body as Message;

    // Handle different message types
    switch (message.type) {
      case "status:heartbeat": {
        const heartbeat = message as HeartbeatMessage;

        // Handle graceful disconnect
        if (heartbeat.payload.disconnect) {
          await updateRunnerStatus(runner.id, "offline");
          activeRunnerSessions.delete(runner.id);
          return NextResponse.json({ ok: true, goodbye: true });
        }

        // Map all heartbeat statuses to valid runner statuses
        let status: "online" | "offline" | "busy";
        switch (heartbeat.payload.status) {
          case "busy":
          case "recording":
          case "debugging":
            status = "busy";
            break;
          default:
            status = "online";
        }

        // Block heartbeat from overriding crash-loop offline status
        const session = activeRunnerSessions.get(runner.id);
        const CRASH_LOOP_THRESHOLD = 3;
        const CRASH_LOOP_WINDOW_MS = 60_000;
        const isCrashLooping =
          session &&
          session.connectCount >= CRASH_LOOP_THRESHOLD &&
          Date.now() - session.firstConnectAt < CRASH_LOOP_WINDOW_MS;

        if (isCrashLooping && status !== "busy") {
          // Don't let crash-looping runner mark itself online
          return NextResponse.json({
            ok: true,
            commands: [],
            crashLoop: true,
            message: `Runner is crash-looping (${session.connectCount} restarts in ${Math.round((Date.now() - session.firstConnectAt) / 1000)}s). Fix the issue and restart.`,
          });
        }

        await updateRunnerStatus(runner.id, status);

        // Dispatch pending commands from DB. Rows stay at status='pending'
        // with dispatchedAt stamped; the runner must POST `response:command_ack`
        // to flip them to 'claimed'. If no ack arrives within REDISPATCH_TTL
        // the next heartbeat redispatches the same row (EB dedup keeps it safe).
        let dispatched = await dispatchPendingCommands(
          runner.id,
          runner.maxParallelTests ?? undefined,
        );

        // Long-poll: if no commands, wait up to 25s for a command to be queued
        if (dispatched.length === 0) {
          const notified = await waitForCommandQueued(runner.id, 25_000);
          if (notified) {
            dispatched = await dispatchPendingCommands(
              runner.id,
              runner.maxParallelTests ?? undefined,
            );
          }
        }

        // Reconstruct Message objects from stored commands
        const commands: Message[] = dispatched.map(
          (cmd) =>
            ({
              id: cmd.id,
              type: cmd.type,
              timestamp: cmd.createdAt ? cmd.createdAt.getTime() : Date.now(),
              payload: cmd.payload,
            }) as unknown as Message,
        );

        if (commands.length > 0) {
          console.log(
            `[Runner ${runner.id}] Returning ${commands.length} claimed commands:`,
            commands.map((c) => c.type),
          );
        }
        return NextResponse.json({
          ok: true,
          commands,
        });
      }

      case "response:test_result": {
        const result = message as TestResultResponse;
        const commandId = result.payload.correlationId;

        // Save video to disk before stripping from payload (too large for DB)
        const payload = { ...result.payload } as Record<string, unknown>;
        if (payload.videoData && payload.videoFilename) {
          try {
            // Validate runner-supplied path segments before composing the
            // destination. Without this, a compromised runner could set
            // `repositoryId='../../../tmp'` and `videoFilename='evil.bin'`
            // to write bytes anywhere the app process can write.
            const rawRepoId =
              typeof payload.repositoryId === "string"
                ? payload.repositoryId
                : "";
            const safeRepoId = rawRepoId
              ? validateRepositoryId(rawRepoId)
              : undefined;
            const repoId = safeRepoId ?? "default";
            const safeFilename = sanitizeVideoFilename(
              payload.videoFilename as string,
            );
            const videoDir = path.join(STORAGE_DIRS.videos, repoId);
            const videoDest = path.join(videoDir, safeFilename);
            assertWithinDir(videoDest, STORAGE_DIRS.videos);
            await fs.mkdir(videoDir, { recursive: true });
            await fs.writeFile(
              videoDest,
              Buffer.from(payload.videoData as string, "base64"),
            );
            // Store the relative path so executor can find it
            payload.videoPath = `/videos/${repoId}/${safeFilename}`;
          } catch (err) {
            // Drop the video on validation failure instead of 500-ing the
            // runner — a misbehaving runner shouldn't block the build.
            if (err instanceof UnsafePathError) {
              console.error(
                `[Runner] Rejected unsafe video path:`,
                err.message,
              );
            } else {
              console.error(`[Runner] Failed to save video:`, err);
            }
          }
        }
        delete payload.videoData;

        // Persist per-attempt selector outcomes into selector_stats so the
        // next run can sort fallback candidates by historical success.
        // Best-effort — never block the test result on stats writes.
        if (
          Array.isArray(result.payload.selectorOutcomes) &&
          result.payload.testId
        ) {
          recordSelectorOutcomes(
            result.payload.testId,
            result.payload.selectorOutcomes,
          ).catch((err) =>
            console.warn(`[Runner] selector_stats ingest failed:`, err),
          );
        }

        // Store result in DB and mark command completed
        const resultStatus =
          result.payload.status === "passed" ? "completed" : "failed";
        try {
          await insertCommandResult({
            commandId,
            runnerId: runner.id,
            type: "response:test_result",
            payload,
          });
        } catch (err) {
          console.error(
            `[Runner] Failed to insert test result for command ${commandId}:`,
            err,
          );
          // Still mark command completed so the executor doesn't hang
        }
        await completeRunnerCommand(
          commandId,
          resultStatus as "completed" | "failed",
        );

        return NextResponse.json({ ok: true });
      }

      case "response:setup_result": {
        const result = message as SetupResultResponse;
        const commandId = result.payload.correlationId;

        // Store result in DB and mark command completed
        const setupStatus =
          result.payload.status === "passed" ? "completed" : "failed";
        await insertCommandResult({
          commandId,
          runnerId: runner.id,
          type: "response:setup_result",
          payload: result.payload as unknown as Record<string, unknown>,
        });
        await completeRunnerCommand(
          commandId,
          setupStatus as "completed" | "failed",
        );

        return NextResponse.json({ ok: true });
      }

      case "response:screenshot": {
        // Handle screenshot upload - save directly to disk
        const screenshotMsg = message as ScreenshotUploadResponse;
        const payload = screenshotMsg.payload;

        try {
          // Validate inputs to prevent path traversal and DoS attacks
          const safeFilename = sanitizeFilename(payload.filename);
          const safeRepoId = validateRepositoryId(payload.repositoryId);
          validateScreenshotSize(payload.data);

          console.log(
            `[Screenshot] Received screenshot from runner ${runner.id}: ${safeFilename}`,
          );

          // Save to disk immediately
          const savedPath = await saveScreenshotToDisk(
            payload.data,
            safeFilename,
            safeRepoId,
          );
          console.log(`[Screenshot] Saved to disk: ${savedPath}`);

          // Store metadata in DB (no base64 data — just path info)
          const commandId = payload.correlationId;
          if (commandId) {
            await insertCommandResult({
              commandId,
              runnerId: runner.id,
              type: "response:screenshot",
              payload: {
                filename: safeFilename,
                path: savedPath,
                repositoryId: safeRepoId,
                testRunId: payload.testRunId,
                width: payload.width,
                height: payload.height,
                capturedAt: payload.capturedAt,
                atMs: payload.atMs,
                title: payload.title,
                domSnapshot: payload.domSnapshot,
              },
            });
          }
        } catch (error) {
          console.error(`[Screenshot] Validation or save failed:`, error);
          return NextResponse.json(
            { error: "Screenshot upload failed" },
            { status: 400 },
          );
        }

        return NextResponse.json({ ok: true });
      }

      case "response:screenshot_text": {
        // Companion text file uploaded alongside a screenshot when text-diff
        // capture is enabled. Stored under the same screenshots/<repoId>/
        // directory so the relative path mirrors the screenshot's by simple
        // extension swap.
        const textMsg = message as ScreenshotTextUploadResponse;
        const payload = textMsg.payload;

        try {
          const safeFilename = sanitizeTextFilename(payload.filename);
          const safeRepoId = validateRepositoryId(payload.repositoryId);
          validateScreenshotTextSize(payload.data);

          const baseDir = STORAGE_DIRS.screenshots;
          const dir = safeRepoId ? path.join(baseDir, safeRepoId) : baseDir;
          const filePath = path.join(dir, safeFilename);
          assertWithinDir(filePath, baseDir);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(filePath, Buffer.from(payload.data, "base64"));
          const relativePath = safeRepoId
            ? `/screenshots/${safeRepoId}/${safeFilename}`
            : `/screenshots/${safeFilename}`;

          const commandId = payload.correlationId;
          if (commandId) {
            await insertCommandResult({
              commandId,
              runnerId: runner.id,
              type: "response:screenshot_text",
              payload: {
                filename: safeFilename,
                path: relativePath,
                repositoryId: safeRepoId,
                testRunId: payload.testRunId,
                capturedAt: payload.capturedAt,
              },
            });
          }
        } catch (error) {
          console.error("[ScreenshotText] Validation or save failed:", error);
          return NextResponse.json(
            { error: "Screenshot text upload failed" },
            { status: 400 },
          );
        }

        return NextResponse.json({ ok: true });
      }

      case "response:network_bodies": {
        const {
          correlationId: commandId,
          testId,
          testRunId,
          repositoryId,
          networkRequests,
        } = message.payload as import("@/lib/ws/protocol").NetworkBodiesPayload;

        if (!commandId || !networkRequests) {
          return NextResponse.json(
            { error: "Missing correlationId or networkRequests" },
            { status: 400 },
          );
        }

        try {
          // All path segments come from the runner — validate as UUIDs so a
          // compromised runner can't traverse out of network-bodies/.
          const safeRepoId = validateRepositoryId(repositoryId) ?? "default";
          const safeTestRunId = validateRepositoryId(testRunId);
          const safeTestId = validateRepositoryId(testId);
          if (!safeTestRunId || !safeTestId) {
            return NextResponse.json(
              { error: "Invalid testRunId or testId" },
              { status: 400 },
            );
          }
          const dir = path.join(STORAGE_DIRS["network-bodies"], safeRepoId);
          const filename = `${safeTestRunId}-${safeTestId}.json`;
          const filePath = path.join(dir, filename);
          assertWithinDir(filePath, STORAGE_DIRS["network-bodies"]);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(filePath, JSON.stringify(networkRequests));
          const relativePath = `/network-bodies/${safeRepoId}/${filename}`;

          await insertCommandResult({
            commandId,
            runnerId: runner.id,
            type: "response:network_bodies",
            payload: { path: relativePath },
          });
        } catch (error) {
          if (error instanceof UnsafePathError) {
            console.error(
              `[NetworkBodies] Rejected unsafe path for test ${testId}:`,
              error.message,
            );
          } else {
            console.error(
              `[NetworkBodies] Failed to save for test ${testId}:`,
              error,
            );
          }
          // Non-blocking — test result is already stored
        }

        return NextResponse.json({ ok: true });
      }

      case "response:command_ack": {
        // Runner confirms receipt of a dispatched command — flip the row
        // from status='pending' (dispatched) to status='claimed' so the
        // sweeper doesn't redispatch it. Idempotent.
        const ackMsg = message as CommandAckResponse;
        const cmdId = ackMsg.payload?.commandId;
        if (typeof cmdId === "string" && cmdId.length > 0) {
          await ackDispatchedCommand(cmdId).catch((err) => {
            console.warn("[command_ack] ackDispatchedCommand failed:", err);
          });
        }
        return NextResponse.json({ ok: true });
      }

      case "response:pong": {
        return NextResponse.json({ ok: true });
      }

      case "response:test_progress": {
        // Progress updates are informational, just acknowledge
        return NextResponse.json({ ok: true });
      }

      case "response:step_event": {
        // Record live step lifecycle into the in-memory step-state store so
        // the test detail page can poll it during headed playback.
        const stepMsg = message as StepEventResponse;
        try {
          recordStepEvent(stepMsg.payload);
        } catch (err) {
          console.warn("[step_event] recordStepEvent failed:", err);
        }
        // Persist a per-command beacon so executor.ts stalled-detection +
        // runners.ts orphan-reclaim see that the EB is actually executing test
        // code. Without this they query runner_command_results directly and
        // mistake step-event progress for an EB that never started. See
        // upsertStepEventBeacon for the why.
        const correlationId = stepMsg.payload.correlationId;
        if (correlationId) {
          upsertStepEventBeacon(correlationId, runner.id, {
            testRunId: stepMsg.payload.testRunId,
            stepIndex: stepMsg.payload.stepIndex,
            totalSteps: stepMsg.payload.totalSteps,
            status: stepMsg.payload.status,
          }).catch((err) =>
            console.warn("[step_event] beacon upsert failed:", err),
          );
        }
        return NextResponse.json({ ok: true });
      }

      case "response:recording_event": {
        const recordingMsg = message as RecordingEventResponse;
        const { sessionId: recSessionId, events } = recordingMsg.payload;

        // Persist to DB first — covers the cross-pod case where the EB POSTs
        // to the *-internal pod but the recording session lives in-memory on
        // the main pod. Same-pod code path also reads from DB, so consumers
        // see events regardless of which pod received them.
        if (events.length > 0) {
          try {
            const { db: dbRw } = await import("@/lib/db");
            const { remoteRecordingEvents: remoteEventsTable } =
              await import("@/lib/db/schema");
            const { sql: sqlOp } = await import("drizzle-orm");
            // Upsert on (sessionId, sequence): the EB re-emits the same
            // sequence when verification settles / a thumbnail arrives, and
            // replaces trailing hover-previews in place — the latest copy is
            // canonical. A batch can also legally contain the same sequence
            // twice (event + its late update flushed together), so dedupe
            // within the batch first; multi-row upserts hitting the same
            // conflict target twice make Postgres error out.
            const latestBySeq = new Map<number, RemoteRecordingEvent>();
            for (const e of events) {
              const ev = e as RemoteRecordingEvent;
              latestBySeq.set(ev.sequence, ev);
            }
            await dbRw
              .insert(remoteEventsTable)
              .values(
                Array.from(latestBySeq.values()).map((e) => ({
                  sessionId: recSessionId,
                  sequence: e.sequence,
                  type: e.type,
                  timestamp: e.timestamp,
                  status: e.status,
                  verification: (e.verification ?? null) as Record<
                    string,
                    unknown
                  > | null,
                  data: e.data as Record<string, unknown>,
                })),
              )
              .onConflictDoUpdate({
                target: [
                  remoteEventsTable.sessionId,
                  remoteEventsTable.sequence,
                ],
                set: {
                  type: sqlOp`excluded.type`,
                  timestamp: sqlOp`excluded.timestamp`,
                  status: sqlOp`excluded.status`,
                  verification: sqlOp`excluded.verification`,
                  data: sqlOp`excluded.data`,
                },
              });
          } catch (err) {
            // On the multi-pod (Olares) split this DB write is the ONLY path
            // back: the EB POSTs to the envoy-less -internal pod, which has no
            // in-memory recording session to append to. A swallowed failure
            // here = every recorded interaction silently lost. Log loudly (not
            // warn) so it surfaces; don't throw — this is best-effort and a 500
            // would break the runner POST channel and trigger retry storms.
            const pgCode =
              (err as { code?: string })?.code ??
              (err as { cause?: { code?: string } })?.cause?.code ??
              "";
            const hint =
              pgCode === "42P10"
                ? " — missing unique index on remote_recording_events(session_id, sequence); run scripts/migrate.js (ensureUniqueIndexes) or create it manually"
                : "";
            console.error(
              `[Recording] CRITICAL: dropped ${events.length} recorded event(s) for session ${recSessionId} (pg ${pgCode || "?"})${hint}`,
              err,
            );
          }
        }

        // If the session exists in THIS process's memory, append directly too
        // so same-pod consumers don't wait for the next DB poll. Re-emits
        // (verification updates, thumbnail attachments) reuse the same
        // sequence — replace in place so the in-memory view shows the
        // latest copy, and queue an eventUpdate so the UI poll (which uses
        // sinceSequence and otherwise wouldn't re-fetch older events) can
        // reconcile in place.
        const session = findRemoteSessionBySessionId(recSessionId);
        if (session) {
          for (const event of events) {
            const incoming = event as RemoteRecordingEvent;
            const existingIdx = session.events.findIndex(
              (e) => e.sequence === incoming.sequence,
            );
            if (existingIdx >= 0) {
              session.events[existingIdx] = incoming;
              const actionId = (incoming.data as { actionId?: string })
                ?.actionId;
              if (actionId) {
                session.pendingEventUpdates ??= [];
                session.pendingEventUpdates.push({
                  actionId,
                  verified: incoming.verification?.domVerified ?? false,
                  selectorMatches: incoming.verification?.selectorMatches,
                  chosenSelector: incoming.verification?.chosenSelector,
                  autoRepaired: incoming.verification?.autoRepaired,
                  thumbnailPath: (incoming.data as { thumbnailPath?: string })
                    ?.thumbnailPath,
                });
              }
            } else {
              session.events.push(incoming);
            }
          }
        }

        return NextResponse.json({ ok: true });
      }

      case "response:recording_stopped": {
        const stoppedMsg = message as RecordingStoppedResponse;
        const { sessionId: stoppedSessionId, domSnapshot: stoppedDomSnapshot } =
          stoppedMsg.payload;

        const session = findRemoteSessionBySessionId(stoppedSessionId);
        if (session) {
          session.isRecording = false;
          if (stoppedDomSnapshot) {
            session.domSnapshot = stoppedDomSnapshot;
          }
          console.log(
            `[Recording] Session ${stoppedSessionId} stopped, ${session.events.length} events, domSnapshot=${stoppedDomSnapshot ? `${stoppedDomSnapshot.elements?.length ?? 0} elements` : "none"}`,
          );
        }

        return NextResponse.json({ ok: true });
      }

      case "response:error": {
        // Runner-side failure (e.g. EB setup step threw during command:start_recording).
        // If the correlationId matches an active recording session, mark it failed
        // so getRecordingStatus() surfaces the error to the client instead of
        // leaving it spinning on isRecording=true.
        const errMsg = message as ErrorResponse;
        const { correlationId, message: errorMessage } = errMsg.payload;
        if (correlationId) {
          const session = findRemoteSessionBySessionId(correlationId);
          if (session) {
            session.isRecording = false;
            session.errorMessage = errorMessage;
            console.log(
              `[Recording] Session ${correlationId} failed: ${errorMessage}`,
            );
          }
        }
        return NextResponse.json({ ok: true });
      }

      case "response:debug_state": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const debugPayload = (message as any)
          .payload as DebugStateResponsePayload;
        const updated = await updateRemoteDebugSessionState(
          debugPayload.sessionId,
          debugPayload,
        );
        if (!updated) {
          console.warn(
            "[wsRunner][POST] debug_state: no session for",
            debugPayload.sessionId,
          );
        }
        return NextResponse.json({ ok: true });
      }

      default:
        console.warn("Unknown message type:", message.type);
        return NextResponse.json(
          { error: "Unknown message type", type: message.type },
          { status: 400 },
        );
    }
  } catch (error) {
    // Log detailed error server-side only (never expose to client)
    console.error("Runner API error:", error);
    console.error("Stack:", error instanceof Error ? error.stack : "N/A");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ws/runner
 * Runner connects and polls for commands
 */
export async function GET(request: NextRequest) {
  ensureInitialized();
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing authorization" },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7);
    const runner = await validateRunnerToken(token);

    if (!runner) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Check for existing active session — detect duplicates vs crash-loops
    const existingSession = activeRunnerSessions.get(runner.id);
    const now = Date.now();

    // Crash-loop detection: track rapid reconnections
    const CRASH_LOOP_WINDOW_MS = 60_000;
    const CRASH_LOOP_THRESHOLD = 3;
    let connectCount = 1;
    let firstConnectAt = now;

    if (existingSession) {
      const timeSinceLastPoll = now - existingSession.lastPoll;

      // If the previous session is genuinely active (recent heartbeat within 5s),
      // this is a true duplicate — reject it
      if (timeSinceLastPoll < 5_000 && existingSession.sessionId !== "") {
        return NextResponse.json(
          {
            error:
              "Duplicate connection: another runner instance is already connected with this token",
          },
          { status: 409 },
        );
      }

      // Track reconnection frequency for crash-loop detection
      if (now - existingSession.firstConnectAt < CRASH_LOOP_WINDOW_MS) {
        connectCount = existingSession.connectCount + 1;
        firstConnectAt = existingSession.firstConnectAt;
      }
      // else: window expired, reset counter (connectCount=1, firstConnectAt=now)
    }

    const isCrashLooping = connectCount >= CRASH_LOOP_THRESHOLD;

    // Generate new session ID
    const sessionId = crypto.randomUUID();

    // Register this session
    activeRunnerSessions.set(runner.id, {
      lastPoll: now,
      sessionId,
      connectCount,
      firstConnectAt,
    });

    if (isCrashLooping) {
      // Mark offline instead of online — don't let a crash-looping runner accept work
      await updateRunnerStatus(runner.id, "offline");
      console.error(
        `[CrashLoop] Runner ${runner.id} reconnected ${connectCount} times in ${Math.round((now - firstConnectAt) / 1000)}s — marking offline. Check container logs.`,
      );
    } else {
      // Set runner to 'online' immediately on connect so stale 'busy' status
      // from a previous crashed session doesn't block task assignment
      await updateRunnerStatus(runner.id, "online");
    }

    // Dispatch any pending commands from DB (limit to maxParallelTests). The
    // runner is responsible for POSTing `response:command_ack` for each one
    // — see the long-poll path for the redispatch story if the ack is lost.
    const dispatched = await dispatchPendingCommands(
      runner.id,
      runner.maxParallelTests ?? undefined,
    );
    const commands: Message[] = dispatched.map(
      (cmd) =>
        ({
          id: cmd.id,
          type: cmd.type,
          timestamp: cmd.createdAt ? cmd.createdAt.getTime() : Date.now(),
          payload: cmd.payload,
        }) as unknown as Message,
    );

    return NextResponse.json({
      runnerId: runner.id,
      teamId: runner.teamId,
      capabilities: runner.capabilities,
      commands,
      sessionId,
    });
  } catch (error) {
    // Log detailed error server-side only (never expose to client)
    console.error("Runner API error:", error);
    console.error("Stack:", error instanceof Error ? error.stack : "N/A");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Save screenshot directly to disk from base64 data.
 */
async function saveScreenshotToDisk(
  base64Data: string,
  filename: string,
  repositoryId?: string,
): Promise<string> {
  const baseDir = STORAGE_DIRS.screenshots;
  const dir = repositoryId ? path.join(baseDir, repositoryId) : baseDir;
  const filePath = path.join(dir, filename);

  // Belt-and-braces: callers already pass through `sanitizeFilename` /
  // `validateRepositoryId`, but reject anything that still escapes the
  // screenshots root so this function is safe regardless of caller.
  assertWithinDir(filePath, baseDir);

  await fs.mkdir(dir, { recursive: true });
  const buffer = Buffer.from(base64Data, "base64");
  await fs.writeFile(filePath, buffer);

  return repositoryId
    ? `/screenshots/${repositoryId}/${filename}`
    : `/screenshots/${filename}`;
}

// ============================================
// DB-backed command queue exports
// ============================================

/**
 * Queue a command for a runner via DB (called by executor and server actions).
 */
export async function queueCommandToDB(
  runnerId: string,
  command: Message,
): Promise<void> {
  console.log(
    `[queueCommandToDB] Queuing ${command.type} for runner ${runnerId}`,
  );
  const payload =
    "payload" in command
      ? (command as unknown as { payload: Record<string, unknown> }).payload
      : {};
  await createRunnerCommand({
    id: command.id,
    runnerId,
    type: command.type,
    status: "pending",
    payload,
    testId: (payload as Record<string, unknown>).testId as string | undefined,
    testRunId: (payload as Record<string, unknown>).testRunId as
      | string
      | undefined,
  });
  notifyCommandQueued(runnerId);
}

/**
 * Queue a cancel command for a runner via DB.
 */
export async function queueCancelCommandToDB(
  runnerId: string,
  testRunId: string,
  reason: string,
): Promise<void> {
  const command: Message = {
    id: crypto.randomUUID(),
    type: "command:cancel_test",
    timestamp: Date.now(),
    payload: {
      testRunId,
      reason,
    },
  } as Message;
  await queueCommandToDB(runnerId, command);
  // Also cancel any unclaimed run commands for this test run
  await cancelPendingCommandsByTestRun(testRunId);
}

// ============================================
// Remote Recording Session Management (in-memory — real-time, acceptable)
// ============================================

const globalRecordingState = globalThis as typeof globalThis & {
  __remoteRecordingSessions?: Map<string, RemoteRecordingSession>;
};
if (!globalRecordingState.__remoteRecordingSessions) {
  globalRecordingState.__remoteRecordingSessions = new Map<
    string,
    RemoteRecordingSession
  >();
}
const remoteRecordingSessionsMap =
  globalRecordingState.__remoteRecordingSessions;

// Remote recording session state
export interface RemoteRecordingEvent {
  type: string;
  timestamp: number;
  sequence: number;
  status: "preview" | "committed";
  verification?: {
    syntaxValid: boolean;
    domVerified?: boolean;
    lastChecked?: number;
    selectorMatches?: Array<{ type: string; value: string; count: number }>;
    chosenSelector?: string;
    autoRepaired?: boolean;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

/** Late update for an action event whose sequence the UI already saw —
 *  verification finished, autorepair settled, or a thumbnail came back from
 *  the runner. Drained on each `getRecordingStatus` poll so the timeline
 *  can reconcile in place without re-fetching the whole event list. */
export interface RemoteRecordingEventUpdate {
  actionId: string;
  verified: boolean;
  selectorMatches?: Array<{ type: string; value: string; count: number }>;
  chosenSelector?: string;
  autoRepaired?: boolean;
  thumbnailPath?: string;
}

export interface RemoteRecordingSession {
  sessionId: string;
  runnerId: string;
  repositoryId: string | null;
  targetUrl: string;
  isRecording: boolean;
  events: RemoteRecordingEvent[];
  generatedCode: string | null;
  startedAt: Date;
  selectorPriority: Array<{ type: string; enabled: boolean; priority: number }>;
  domSnapshot?: import("@/lib/db/schema").DomSnapshotData;
  errorMessage?: string;
  pendingEventUpdates?: RemoteRecordingEventUpdate[];
}

function findRemoteSessionBySessionId(
  sessionId: string,
): RemoteRecordingSession | undefined {
  for (const session of remoteRecordingSessionsMap.values()) {
    if (session.sessionId === sessionId) return session;
  }
  return undefined;
}

/**
 * Create a new remote recording session (called by recording action)
 */
export function createRemoteRecordingSession(
  sessionId: string,
  runnerId: string,
  repositoryId: string | null,
  targetUrl: string,
  selectorPriority: Array<{ type: string; enabled: boolean; priority: number }>,
): void {
  const session: RemoteRecordingSession = {
    sessionId,
    runnerId,
    repositoryId,
    targetUrl,
    isRecording: true,
    events: [],
    generatedCode: null,
    startedAt: new Date(),
    selectorPriority,
  };
  // Key by repositoryId so getRecordingStatus can find it
  const key = repositoryId ?? "__no_repo__";
  remoteRecordingSessionsMap.set(key, session);
  console.log(
    `[Recording] Created remote session ${sessionId} for runner ${runnerId}`,
  );
}

/**
 * Get the active remote recording session for a repository
 */
export function getRemoteRecordingSession(
  repositoryId?: string | null,
): RemoteRecordingSession | null {
  const key = repositoryId ?? "__no_repo__";
  const session = remoteRecordingSessionsMap.get(key);
  return session ?? null;
}

/**
 * Get events from a remote recording session since a given sequence number.
 * Merges same-pod in-memory state with DB-persisted events (which may have
 * arrived on a different pod, e.g. the envoy-less *-internal pod that EBs POST
 * to in kubernetes mode). Deduped by sequence.
 */
export async function getRemoteRecordingEvents(
  repositoryId?: string | null,
  sinceSequence?: number,
): Promise<RemoteRecordingEvent[]> {
  const session = getRemoteRecordingSession(repositoryId);
  if (!session) return [];

  const memEvents =
    sinceSequence !== undefined
      ? session.events.filter((e) => e.sequence > sinceSequence)
      : session.events;

  let dbEvents: RemoteRecordingEvent[] = [];
  try {
    const { db: dbRo } = await import("@/lib/db");
    const { remoteRecordingEvents: remoteEventsTable } =
      await import("@/lib/db/schema");
    const { and: andOp, eq: eqOp, gt: gtOp } = await import("drizzle-orm");
    const where =
      sinceSequence !== undefined
        ? andOp(
            eqOp(remoteEventsTable.sessionId, session.sessionId),
            gtOp(remoteEventsTable.sequence, sinceSequence),
          )
        : eqOp(remoteEventsTable.sessionId, session.sessionId);
    const rows = await dbRo
      .select()
      .from(remoteEventsTable)
      .where(where)
      .orderBy(remoteEventsTable.sequence);
    dbEvents = rows.map((r) => ({
      type: r.type,
      timestamp: r.timestamp,
      sequence: r.sequence,
      status: r.status as "preview" | "committed",
      verification: (r.verification ??
        undefined) as RemoteRecordingEvent["verification"],
      data: (r.data ?? {}) as Record<string, unknown>,
    }));
  } catch (err) {
    console.warn(
      "[Recording] DB fetch failed, falling back to in-memory only:",
      err,
    );
  }

  // Dedupe by sequence; prefer DB rows (canonical).
  const seen = new Map<number, RemoteRecordingEvent>();
  for (const e of memEvents) seen.set(e.sequence, e);
  for (const e of dbEvents) seen.set(e.sequence, e);
  return Array.from(seen.values()).sort((a, b) => a.sequence - b.sequence);
}

/**
 * Mark a remote recording session as stopped and store generated code
 */
export function completeRemoteRecordingSession(
  repositoryId?: string | null,
  generatedCode?: string,
): void {
  const session = getRemoteRecordingSession(repositoryId);
  if (session) {
    session.isRecording = false;
    if (generatedCode) {
      session.generatedCode = generatedCode;
    }
  }
}

/**
 * Remove a remote recording session
 */
export async function clearRemoteRecordingSession(
  repositoryId?: string | null,
): Promise<void> {
  const key = repositoryId ?? "__no_repo__";
  const session = remoteRecordingSessionsMap.get(key);
  remoteRecordingSessionsMap.delete(key);
  if (session) {
    try {
      const { db: dbRw } = await import("@/lib/db");
      const { remoteRecordingEvents: remoteEventsTable } =
        await import("@/lib/db/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      await dbRw
        .delete(remoteEventsTable)
        .where(eqOp(remoteEventsTable.sessionId, session.sessionId));
    } catch (err) {
      console.warn(
        `[Recording] Failed to clear DB events for session ${session.sessionId}:`,
        err,
      );
    }
  }
}

// ============================================
// Remote Debug Session Management
// ============================================
// State lives in Postgres (`remote_debug_sessions`) because on Olares the
// UI-facing pod (`lastest-dev`) creates the session and the envoy-less pod
// (`lastest-internal-dev`) receives the EB's `response:debug_state` POSTs.
// Pre-DB this was a globalThis Map, which silently broke on that split.

import type { DebugStateResponsePayload } from "@/lib/ws/protocol";
import { db } from "@/lib/db";
import { remoteDebugSessions } from "@/lib/db/schema";
import {
  eq as drizzleEq,
  and as drizzleAnd,
  isNull as drizzleIsNull,
} from "drizzle-orm";

export interface RemoteDebugSession {
  sessionId: string;
  runnerId: string;
  repositoryId: string | null;
  testId: string;
  state: DebugStateResponsePayload | null;
  startedAt: Date;
  /** Set once the stop-recording splice has been persisted as a test version.
   *  Durable across runner state pushes — used by consumeStopRecording as an
   *  idempotency guard so a re-entrant poll can't splice/persist twice. */
  splicedAt: Date | null;
}

export async function createRemoteDebugSession(
  sessionId: string,
  runnerId: string,
  repositoryId: string | null,
  testId: string,
): Promise<void> {
  await db
    .insert(remoteDebugSessions)
    .values({
      sessionId,
      runnerId,
      repositoryId,
      testId,
      state: null,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: remoteDebugSessions.sessionId,
      set: {
        runnerId,
        repositoryId,
        testId,
        state: null,
        updatedAt: new Date(),
      },
    });
  console.log(
    `[Debug] Created remote session ${sessionId} for runner ${runnerId}`,
  );
}

export async function getRemoteDebugSession(
  sessionId: string,
): Promise<RemoteDebugSession | null> {
  const [row] = await db
    .select()
    .from(remoteDebugSessions)
    .where(drizzleEq(remoteDebugSessions.sessionId, sessionId))
    .limit(1);
  if (!row) return null;
  return {
    sessionId: row.sessionId,
    runnerId: row.runnerId,
    repositoryId: row.repositoryId,
    testId: row.testId,
    state: row.state as DebugStateResponsePayload | null,
    startedAt: row.startedAt,
    splicedAt: row.splicedAt ?? null,
  };
}

async function updateRemoteDebugSessionState(
  sessionId: string,
  state: DebugStateResponsePayload,
): Promise<boolean> {
  const result = await db
    .update(remoteDebugSessions)
    .set({ state, updatedAt: new Date() })
    .where(drizzleEq(remoteDebugSessions.sessionId, sessionId))
    .returning({ sessionId: remoteDebugSessions.sessionId });
  return result.length > 0;
}

export async function clearRemoteDebugSession(
  sessionId: string,
): Promise<void> {
  await db
    .delete(remoteDebugSessions)
    .where(drizzleEq(remoteDebugSessions.sessionId, sessionId));
}

/**
 * Atomically claim the stop-recording splice for a session by setting
 * `splicedAt` — but only if it is still null. Returns true if THIS call won
 * the claim (caller should proceed to splice + persist), false if another call
 * already claimed it (caller must treat the splice as already done).
 *
 * `splicedAt` lives in its own column, not inside `state`, so the runner's
 * debug_state pushes (which overwrite the whole `state` blob and keep
 * reporting pendingRecordingEvents until update_code round-trips) cannot
 * re-arm a consumed splice. This is the durable double-splice guard.
 */
export async function claimRecordingSplice(
  sessionId: string,
): Promise<boolean> {
  const result = await db
    .update(remoteDebugSessions)
    .set({ splicedAt: new Date(), updatedAt: new Date() })
    .where(
      drizzleAnd(
        drizzleEq(remoteDebugSessions.sessionId, sessionId),
        drizzleIsNull(remoteDebugSessions.splicedAt),
      ),
    )
    .returning({ sessionId: remoteDebugSessions.sessionId });
  return result.length > 0;
}

/**
 * Release a splice claim — used when the persist step fails so a later poll can
 * retry the splice. Pairs with claimRecordingSplice.
 */
export async function releaseRecordingSplice(sessionId: string): Promise<void> {
  await db
    .update(remoteDebugSessions)
    .set({ splicedAt: null, updatedAt: new Date() })
    .where(drizzleEq(remoteDebugSessions.sessionId, sessionId));
}
