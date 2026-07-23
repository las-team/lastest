/**
 * HTTP client for the EB pool service (`packages/pool-service/`) — the app's ONLY
 * path to browser-capacity operations. The app holds no Kubernetes
 * credentials; provisioning, caps, warm-pool and job reaping live in the
 * singleton pool-service process.
 *
 * Every call degrades gracefully when the service is unreachable: reads
 * return null/empty, writes no-op with a rate-limited warning. The app then
 * behaves as if the pool were at capacity ("no browser available"), which is
 * the correct user-visible failure mode.
 *
 * Env:
 *   EB_POOL_SERVICE_URL    default http://127.0.0.1:9500
 *   EB_POOL_SERVICE_TOKEN  bearer token, must match the service's env
 */

import type { EBPodInfo } from "./provisioner";

export type { EBPodInfo };

function baseUrl(): string {
  return (process.env.EB_POOL_SERVICE_URL || "http://127.0.0.1:9500").replace(
    /\/$/,
    "",
  );
}

// Rate-limit "service unreachable" warnings so a down service doesn't flood
// logs from every claim/release call site.
let lastUnreachableWarnAt = 0;
function warnUnreachable(op: string, err: unknown): void {
  const now = Date.now();
  if (now - lastUnreachableWarnAt > 60_000) {
    lastUnreachableWarnAt = now;
    console.warn(
      `[PoolClient] ${op} failed — is the pool service running? (${baseUrl()}, pnpm pool in dev):`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function poolFetch(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = (process.env.EB_POOL_SERVICE_TOKEN || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  try {
    return await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Pool occupancy: idle-claimable EBs, total provisioned (incl. in-flight),
 *  cluster cap. Null when the service is unreachable. */
export async function getPoolStatus(): Promise<{
  online: number;
  size: number;
  max: number;
} | null> {
  try {
    const res = await poolFetch("/v1/pool");
    if (!res.ok) throw new Error(`status ${res.status}`);
    return (await res.json()) as { online: number; size: number; max: number };
  } catch (err) {
    warnUnreachable("getPoolStatus", err);
    return null;
  }
}

/**
 * Ask the service to create one EB Job. Cap enforcement (including the
 * build/interactive reservation) happens service-side. Returns null when at
 * capacity, provisioning is disabled, or the service is unreachable — the
 * caller treats all three as "cannot provision".
 */
export async function provisionEB(
  purpose: "build" | "interactive",
): Promise<{ jobName: string; instanceId: string } | null> {
  try {
    // Generous timeout: the service serializes launches through its CNI
    // throttle (EB_LAUNCH_INTERVAL_MS), so a burst can queue for a few seconds.
    const res = await poolFetch("/v1/provisions", {
      method: "POST",
      body: { purpose },
      timeoutMs: 30_000,
    });
    if (res.status === 201) {
      return (await res.json()) as { jobName: string; instanceId: string };
    }
    if (res.status === 409) return null; // at capacity / provisioning disabled — service already logged why
    throw new Error(`status ${res.status}`);
  } catch (err) {
    warnUnreachable("provisionEB", err);
    return null;
  }
}

/** Delete the k8s Job (and its Pod). 404-tolerant, mirrors kubectl delete. */
export async function terminatePoolJob(jobName: string): Promise<void> {
  try {
    await poolFetch(`/v1/jobs/${encodeURIComponent(jobName)}`, {
      method: "DELETE",
    });
  } catch (err) {
    warnUnreachable("terminatePoolJob", err);
  }
}

/** Forensic pod status + log tail for `[EB-dead]` diagnostics. Best-effort. */
export async function getEBPodInfo(
  jobName: string,
  tailLines = 80,
): Promise<EBPodInfo | null> {
  try {
    const res = await poolFetch(
      `/v1/jobs/${encodeURIComponent(jobName)}/diagnostics?tailLines=${tailLines}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as EBPodInfo;
  } catch (err) {
    warnUnreachable("getEBPodInfo", err);
    return null;
  }
}

/**
 * Names of currently-existing EB Jobs. Returns NULL (not an empty set) when
 * the answer is unknown — callers pruning "phantom" runner rows must skip on
 * null, otherwise a transient service/cluster hiccup would classify every
 * live EB as a phantom and delete its rows.
 */
export async function listEBJobNames(): Promise<Set<string> | null> {
  try {
    const res = await poolFetch("/v1/jobs");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { jobs: string[] };
    return new Set(data.jobs);
  } catch (err) {
    warnUnreachable("listEBJobNames", err);
    return null;
  }
}

/** Fire-and-forget warm-pool top-up. The service also refills on its own
 *  60s loop; this just breaks the pool-drained-to-zero dead state faster. */
export async function ensureWarmPool(): Promise<void> {
  try {
    await poolFetch("/v1/warm-pool/ensure", { method: "POST", body: {} });
  } catch (err) {
    warnUnreachable("ensureWarmPool", err);
  }
}

/** Pre-launch up to `count` EB Jobs for a build. Returns the number launched
 *  (0 when at cap or the service is unreachable). */
export async function prewarmForBuild(count: number): Promise<number> {
  try {
    const res = await poolFetch("/v1/prewarm", {
      method: "POST",
      body: { count },
      timeoutMs: 60_000,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return ((await res.json()) as { launched: number }).launched;
  } catch (err) {
    warnUnreachable("prewarmForBuild", err);
    return 0;
  }
}

/**
 * Build-dispatch warm-pool suppression hints. Fire-and-forget: a lost or
 * re-ordered hint costs at most one wasted warm EB launch, and the service's
 * counter is clamped at zero.
 */
export function incBuildDispatch(): void {
  poolFetch("/v1/build-dispatch", {
    method: "POST",
    body: { action: "inc" },
  }).catch((err) => warnUnreachable("incBuildDispatch", err));
}

export function decBuildDispatch(): void {
  poolFetch("/v1/build-dispatch", {
    method: "POST",
    body: { action: "dec" },
  }).catch((err) => warnUnreachable("decBuildDispatch", err));
}
