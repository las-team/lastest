/**
 * EB Pool Service — standalone singleton process owning the browser-capacity
 * plane: Kubernetes Job provisioning, pool caps/warm-pool/launch throttling,
 * and the idle/stale reapers.
 *
 * Why a separate process (see docs discussion, "one process per trust
 * domain, one service per state domain"):
 *   - It is the ONLY process holding infra credentials (in-pod SA token or
 *     kubeconfig). The Next.js app keeps zero cluster access.
 *   - The pool's in-memory state (in-flight provisions, launch throttle,
 *     build-dispatch suppression) is only correct in a single process; app
 *     replicas each had their own copies before the extraction.
 *   - Pool failures (k8s API slowness, CNI flakes) get their own logs,
 *     health endpoint and lifecycle, isolated from the app's event loop.
 *
 * The app talks to this over HTTP via `@lastest/pool-service/client`.
 *
 * HTTP surface (JSON):
 *   GET    /health                       → { ok, kubernetesMode }
 *   GET    /v1/pool                      → { online, size, max }
 *   GET    /v1/jobs                      → { jobs: string[] }
 *   DELETE /v1/jobs/:name                → 204 (404-tolerant, like kubectl)
 *   GET    /v1/jobs/:name/diagnostics    → EBPodInfo | 404
 *   POST   /v1/provisions {purpose}      → 201 { jobName, instanceId } | 409
 *   POST   /v1/warm-pool/ensure          → { launched }
 *   POST   /v1/prewarm {count}           → { launched }
 *   POST   /v1/build-dispatch {action}   → 204   (action: "inc" | "dec")
 *
 * Env:
 *   EB_POOL_PORT           listen port (default 9500)
 *   EB_POOL_HOST           bind address (default 127.0.0.1 — loopback only;
 *                          set 0.0.0.0 for a dedicated k8s Deployment, and
 *                          set EB_POOL_SERVICE_TOKEN when you do)
 *   EB_POOL_SERVICE_TOKEN  optional shared secret; when set, every /v1 route
 *                          requires `Authorization: Bearer <token>`
 *   (+ all EB_* provisioning knobs read by provisioner.ts, DATABASE_URL)
 */

import http from "node:http";
import crypto from "node:crypto";
import { db, sql } from "@lastest/db";
import { runners } from "@lastest/db/schema";
import { and, eq } from "drizzle-orm";
import { isKubernetesMode } from "./common";
import {
  currentPoolSize,
  decBuildDispatch,
  decInFlightProvisions,
  ensureWarmPool,
  getEBPodInfo,
  incBuildDispatch,
  incInFlightProvisions,
  interactiveReservedSlots,
  launchEBJob,
  listEBJobNames,
  poolMax,
  prewarmForBuild,
  terminateEBJob,
} from "./provisioner";
import { startPoolLoop, stopPoolLoop } from "./reapers";

const PORT = parseInt(process.env.EB_POOL_PORT || "9500", 10);
const HOST = process.env.EB_POOL_HOST || "127.0.0.1";
const TOKEN = (process.env.EB_POOL_SERVICE_TOKEN || "").trim();

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) return true; // loopback-only default binding is the guard
  const header = req.headers.authorization || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Provision one EB Job, enforcing the pool cap with the build/interactive
 * reservation. Moved from the app's `claimOrProvisionPoolEB` — the cap check,
 * in-flight reservation and launch throttle all need singleton state, so they
 * live here. The APP still polls the DB for the pod's auto-registration and
 * claims it; this endpoint's contract is only "a Job now exists (or cannot)".
 *
 * The in-flight reservation is decremented by a DB watcher (below) when the
 * pod's runner row appears — with a 120s grace fallback mirroring
 * `ensureWarmPool` — so a crashed pod can't pin pool capacity forever.
 */
async function handleProvision(
  purpose: "build" | "interactive",
): Promise<
  | { status: 201; body: { jobName: string; instanceId: string } }
  | { status: 409 | 500; body: { error: string; size?: number; cap?: number } }
> {
  if (!isKubernetesMode()) {
    return {
      status: 409,
      body: { error: "EB_PROVISIONER is not 'kubernetes'" },
    };
  }

  const size = await currentPoolSize();
  const cap = await poolMax();
  const reserved = purpose === "build" ? interactiveReservedSlots() : 0;
  const effectiveCap = Math.max(0, cap - reserved);
  if (size >= effectiveCap) {
    console.warn(
      reserved > 0
        ? `[Pool] At build cap (${size}/${effectiveCap}, hard cap ${cap}, reserved ${reserved} for interactive) — cannot provision new EB for build`
        : `[Pool] At capacity (${size}/${cap}) — cannot provision new EB`,
    );
    return { status: 409, body: { error: "at-capacity", size, cap } };
  }

  incInFlightProvisions();
  let jobInfo: { jobName: string; instanceId: string };
  try {
    jobInfo = await launchEBJob();
  } catch (err) {
    decInFlightProvisions();
    console.error("[Pool] launchEBJob failed:", err);
    return { status: 500, body: { error: String(err) } };
  }

  watchForRegistration(jobInfo.instanceId);
  return { status: 201, body: jobInfo };
}

/** Decrement the in-flight reservation once the pod's runner row exists
 *  (then it counts via `currentPoolSize`'s DB query instead), or after a
 *  120s grace period if it never registers. */
function watchForRegistration(instanceId: string): void {
  const expectedRunnerName = `System EB-${instanceId}`;
  const deadline = Date.now() + 120_000;
  const timer = setInterval(async () => {
    let done = Date.now() > deadline;
    if (!done) {
      try {
        const [row] = await db
          .select({ id: runners.id })
          .from(runners)
          .where(
            and(
              eq(runners.name, expectedRunnerName),
              eq(runners.isSystem, true),
            ),
          )
          .limit(1);
        done = !!row;
      } catch {
        // DB hiccup — keep polling until the grace deadline
      }
    }
    if (done) {
      clearInterval(timer);
      decInFlightProvisions();
    }
  }, 2_000);
  timer.unref?.();
}

async function poolStatus(): Promise<{
  online: number;
  size: number;
  max: number;
}> {
  const onlineRows = await db
    .select({ id: runners.id })
    .from(runners)
    .where(
      and(
        eq(runners.isSystem, true),
        eq(runners.status, "online"),
        eq(runners.type, "embedded"),
      ),
    );
  const [size, max] = await Promise.all([currentPoolSize(), poolMax()]);
  return { online: onlineRows.length, size, max };
}

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    return json(res, 200, { ok: true, kubernetesMode: isKubernetesMode() });
  }

  if (!path.startsWith("/v1/")) return json(res, 404, { error: "not found" });
  if (!isAuthorized(req)) return json(res, 401, { error: "unauthorized" });

  if (req.method === "GET" && path === "/v1/pool") {
    return json(res, 200, await poolStatus());
  }

  if (req.method === "GET" && path === "/v1/jobs") {
    return json(res, 200, { jobs: [...(await listEBJobNames())] });
  }

  const jobMatch = path.match(/^\/v1\/jobs\/([^/]+)(\/diagnostics)?$/);
  if (jobMatch) {
    const jobName = decodeURIComponent(jobMatch[1]!);
    if (req.method === "DELETE" && !jobMatch[2]) {
      await terminateEBJob(jobName);
      res.writeHead(204).end();
      return;
    }
    if (req.method === "GET" && jobMatch[2]) {
      const tailLines = parseInt(url.searchParams.get("tailLines") || "80", 10);
      const info = await getEBPodInfo(jobName, tailLines);
      if (!info) return json(res, 404, { error: "no pod info" });
      return json(res, 200, info);
    }
  }

  if (req.method === "POST" && path === "/v1/provisions") {
    const body = await readJsonBody(req);
    const purpose = body.purpose === "build" ? "build" : "interactive";
    const result = await handleProvision(purpose);
    return json(res, result.status, result.body);
  }

  if (req.method === "POST" && path === "/v1/warm-pool/ensure") {
    return json(res, 200, { launched: await ensureWarmPool() });
  }

  if (req.method === "POST" && path === "/v1/prewarm") {
    const body = await readJsonBody(req);
    const count = typeof body.count === "number" ? body.count : 0;
    return json(res, 200, { launched: await prewarmForBuild(count) });
  }

  if (req.method === "POST" && path === "/v1/build-dispatch") {
    const body = await readJsonBody(req);
    if (body.action === "inc") incBuildDispatch();
    else if (body.action === "dec") decBuildDispatch();
    else return json(res, 400, { error: "action must be 'inc' or 'dec'" });
    res.writeHead(204).end();
    return;
  }

  json(res, 404, { error: "not found" });
}

async function main(): Promise<void> {
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(`[PoolService] ${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) json(res, 500, { error: String(err) });
      else res.destroy();
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(
      `[PoolService] listening on http://${HOST}:${PORT} (mode=${isKubernetesMode() ? "kubernetes" : "none"}, auth=${TOKEN ? "bearer" : "loopback"})`,
    );
  });

  // Boot tasks — best-effort: the HTTP surface must come up even when the DB
  // or cluster is briefly unreachable (the loop retries every 60s anyway).
  try {
    const { ensureGlobalPlaywrightSettings } =
      await import("@lastest/db/settings");
    await ensureGlobalPlaywrightSettings();
    if (isKubernetesMode()) {
      const launched = await ensureWarmPool();
      if (launched > 0)
        console.log(`[PoolService] Warm pool topped up (+${launched}) at boot`);
    }
  } catch (err) {
    console.error("[PoolService] boot warm-pool init failed:", err);
  }

  startPoolLoop();

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`[PoolService] ${sig} — shutting down`);
      stopPoolLoop();
      server.close(() => {
        sql.end({ timeout: 5 }).finally(() => process.exit(0));
      });
      // Hard exit if close hangs on a stuck keep-alive socket
      setTimeout(() => process.exit(0), 5_000).unref();
    });
  }
}

main().catch((err) => {
  console.error("[PoolService] fatal:", err);
  process.exit(1);
});
