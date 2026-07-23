/**
 * EB Pool Service — standalone singleton process owning the browser-capacity
 * plane: Kubernetes Job provisioning, pool caps/warm-pool/launch throttling,
 * and the idle/stale reapers.
 *
 * Why a separate process (see docs discussion, "one process per trust
 * domain, one service per state domain"):
 *   - It is the ONLY process holding infra credentials (in-pod SA token or
 *     kubeconfig). The Next.js app keeps zero cluster access.
 *   - The pool's serialized provision path (provision lock, launch throttle,
 *     build-dispatch suppression) is only correct in a single process; app
 *     replicas each had their own copies before the extraction. Capacity
 *     itself has no in-memory counter — the ledger is the backend (live k8s
 *     Jobs / live child processes), so it survives restarts.
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

// MUST be first: fills process.env from .env.local before @lastest/db
// captures DATABASE_URL at module-init time.
import "./env";
import http from "node:http";
import crypto from "node:crypto";
import { db, sql } from "@lastest/db";
import { runners } from "@lastest/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { isDynamicPoolMode, isKubernetesMode, provisionerMode } from "./common";
import { terminateAllEBProcesses } from "./process-provisioner";
import {
  AtCapacityError,
  cachedLivePoolCount,
  decBuildDispatch,
  ensureWarmPool,
  getEBPodInfo,
  incBuildDispatch,
  listEBJobNames,
  poolMax,
  prewarmForBuild,
  provisionOneEB,
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
 * reservation. Moved from the app's `claimOrProvisionPoolEB` — the serialized
 * capacity decision and launch throttle need singleton state, so they live
 * here (in `provisionOneEB`). The APP still polls the DB for the pod's
 * auto-registration and claims it; this endpoint's contract is only "a Job
 * now exists (or cannot)".
 *
 * A k8s-ledger read failure surfaces as 500, never as a provision: capacity
 * decisions fail closed rather than falling back to a count that can't see
 * unregistered Jobs.
 */
async function handleProvision(
  purpose: "build" | "interactive",
): Promise<
  | { status: 201; body: { jobName: string; instanceId: string } }
  | { status: 409 | 500; body: { error: string; size?: number; cap?: number } }
> {
  if (!isDynamicPoolMode()) {
    return {
      status: 409,
      body: {
        error:
          "EB provisioning is disabled (EB_PROVISIONER=disabled, or not a dev checkout — set EB_PROVISIONER=kubernetes or =process)",
      },
    };
  }

  try {
    return { status: 201, body: await provisionOneEB(purpose) };
  } catch (err) {
    if (err instanceof AtCapacityError) {
      console.warn(
        purpose === "build"
          ? `[Pool] At build cap (${err.size}/${err.cap} incl. interactive reservation) — cannot provision new EB for build`
          : `[Pool] At capacity (${err.size}/${err.cap}) — cannot provision new EB`,
      );
      return {
        status: 409,
        body: { error: "at-capacity", size: err.size, cap: err.cap },
      };
    }
    console.error("[Pool] provisionOneEB failed:", err);
    return { status: 500, body: { error: String(err) } };
  }
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
  const [cachedSize, max] = await Promise.all([
    cachedLivePoolCount(),
    poolMax(),
  ]);
  let size = cachedSize;
  if (size === null) {
    // Ledger unreachable (k8s API down) — degrade to the DB proxy of
    // non-offline system EB rows. Display-only: provision decisions never
    // take this path (they fail closed inside provisionOneEB).
    const rows = await db
      .select({ id: runners.id })
      .from(runners)
      .where(
        and(
          eq(runners.isSystem, true),
          eq(runners.type, "embedded"),
          ne(runners.status, "offline"),
        ),
      );
    size = rows.length;
  }
  return { online: onlineRows.length, size, max };
}

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    return json(res, 200, {
      ok: true,
      mode: provisionerMode(),
      // kept for older clients that only know the boolean
      kubernetesMode: isKubernetesMode(),
    });
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
      `[PoolService] listening on http://${HOST}:${PORT} (mode=${provisionerMode()}, auth=${TOKEN ? "bearer" : "loopback"})`,
    );
  });

  // Boot tasks — best-effort: the HTTP surface must come up even when the DB
  // or cluster is briefly unreachable (the loop retries every 60s anyway).
  try {
    const { ensureGlobalPlaywrightSettings } =
      await import("@lastest/db/settings");
    await ensureGlobalPlaywrightSettings();
    if (isDynamicPoolMode()) {
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
      // Process-mode EBs are children of this process — take them down with
      // us (SIGTERM here; the exit hook SIGKILLs any survivor).
      terminateAllEBProcesses();
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
