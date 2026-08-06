/**
 * Embedded Browser Provisioner — runs INSIDE THE POOL SERVICE process only.
 *
 * On-demand EB provisioning behind two interchangeable backends:
 *   - kubernetes: one k8s Job per EB (this file's k8s client). The only code
 *     in the repo that talks to the Kubernetes API; the app reaches it through
 *     the HTTP surface in `packages/pool-service/src/main.ts` via
 *     `@lastest/pool-service/client`, and holds no cluster credentials itself.
 *   - process: one local child process per EB (`./process-provisioner.ts`) —
 *     the zero-config default in a dev checkout. Same pool caps, throttle,
 *     reapers and per-session bootstrap tokens; "Job" in the exported API
 *     names just means "one provisioned EB" there.
 *
 * Capacity accounting has no in-memory counter: the ledger is the backend
 * itself. A k8s Job exists in the API the instant creation returns (no
 * create→register gap to bridge), and a process-mode child is in the process
 * map synchronously at spawn — so `livePoolCount()` is authoritative in both
 * modes, survives pool-service restarts, and counts crashed-but-unreaped
 * units for exactly as long as they hold real resources. Provision decisions
 * are serialized through `withProvisionLock` so a fresh ledger read + create
 * is atomic.
 *
 * The remaining in-memory state (provision lock, launch throttle chain,
 * build-dispatch flag) is correct because the pool service is a singleton by
 * design — do NOT import this from app code, where multiple replicas would
 * each get their own copies (the bug that motivated the extraction).
 *
 * Model:
 *   - One Job = one browser = one test (1 test per EB).
 *   - A single build can claim up to `maxParallelEBs` Jobs concurrently.
 *   - Total cluster pool is capped by the global `playwright_settings.ebPoolMax` (default 30).
 *   - Each Job is short-lived. After the worker releases the EB, the Job is
 *     deleted (subject to a small idle-TTL to absorb back-to-back tests).
 *
 * Controlled via env (deployment topology / infra):
 *   EB_PROVISIONER     = 'kubernetes' | 'process' | 'disabled'
 *                        (default: 'process' in a dev checkout, else disabled —
 *                        see provisionerMode() in ./common.ts)
 *   EB_NAMESPACE       = k8s namespace (default: 'lastest')
 *   EB_IMAGE           = container image for the EB
 *   EB_WARM_POOL_MIN   = min EBs to keep alive while idle (default: 2)
 *   EB_RESERVED_INTERACTIVE_SLOTS = pool slots reserved for recording/debug/AI
 *                                   (kept off-limits to build dispatch). Default: 2.
 *   EB_CPU_REQUEST / EB_CPU_LIMIT / EB_MEM_REQUEST / EB_MEM_LIMIT
 *   EB_SHM_SIZE        = /dev/shm size (default: '512Mi') — Chromium crash guard
 *   EB_ACTIVE_DEADLINE_SECONDS (default: 1800)
 *   EB_TTL_SECONDS_AFTER_FINISHED (default: 60)
 *   LASTEST_URL        = URL the EB calls back to (default: in-cluster service DNS)
 *   ENCRYPTION_KEY     = signs the per-Job EB_BOOTSTRAP_TOKEN (required in
 *                        kubernetes mode; must match the app's key)
 *
 * Controlled via the global `playwright_settings` row (cluster-wide, DB):
 *   ebPoolMax          = hard cap on concurrent EBs (schema default: 30)
 *   ebIdleTTLSeconds   = idle timeout before a released EB Job is torn down
 *                        (process mode caps the effective max at
 *                        EB_PROCESS_POOL_MAX, default 4 — local Chromiums are
 *                        expensive)
 *
 * The provisioner is a no-op when provisioning is disabled (mode 'none').
 */

import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import https from "https";
import {
  isDynamicPoolMode,
  isKubernetesMode,
  mintBootstrapToken,
  provisionerMode,
} from "./common";
import {
  getEBProcessInfo,
  launchEBProcess,
  listEBProcessNames,
  terminateEBProcess,
} from "./process-provisioner";

const SA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount";

// Cluster-wide EB pool limits live in the global `playwright_settings` row.
// Short in-process cache so hot paths (isPoolBusy, claimOrProvisionPoolEB) don't
// hammer the DB — cap changes are rare, pool decisions are frequent.
let _limitsCache: {
  value: { ebPoolMax: number; ebIdleTTLSeconds: number };
  expiresAt: number;
} | null = null;
const LIMITS_CACHE_TTL_MS = 5000;

async function readPoolLimits(): Promise<{
  ebPoolMax: number;
  ebIdleTTLSeconds: number;
}> {
  if (_limitsCache && Date.now() < _limitsCache.expiresAt)
    return _limitsCache.value;
  const { getGlobalPoolLimits } = await import("@lastest/db/settings");
  const row = await getGlobalPoolLimits();
  if (!row) {
    throw new Error(
      "Global playwright_settings row missing — call ensureGlobalPlaywrightSettings() during app boot or create one via the settings UI",
    );
  }
  _limitsCache = { value: row, expiresAt: Date.now() + LIMITS_CACHE_TTL_MS };
  return row;
}

export async function poolMax(): Promise<number> {
  const dbMax = (await readPoolLimits()).ebPoolMax;
  if (provisionerMode() !== "process") return dbMax;
  // Every process-mode EB is a full local Chromium; the cluster-sized DB cap
  // (default 30) would let one build melt a laptop.
  const n = parseInt(process.env.EB_PROCESS_POOL_MAX || "4", 10);
  const processMax = Number.isFinite(n) && n > 0 ? n : 4;
  return Math.min(dbMax, processMax);
}

export async function ebIdleTTLMs(): Promise<number> {
  return (await readPoolLimits()).ebIdleTTLSeconds * 1000;
}

export function warmPoolMin(): number {
  // Process mode defaults to a cold pool: idle warm EBs are whole Chromium
  // processes on the dev machine, and local spawn latency (~2-5s) is cheap
  // enough to pay per test. Opt back in with EB_WARM_POOL_MIN.
  const fallback = provisionerMode() === "process" ? 0 : 2;
  const n = parseInt(process.env.EB_WARM_POOL_MIN || String(fallback), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Pool slots held back from build dispatch so interactive callers
// (recording, debug, AI) can always provision a fresh EB even when builds
// have saturated the cluster. Recurring "Live-stream canvas never mounted"
// failures traced to bursty cron-build overlap pushing the pool size to
// ebPoolMax before a recording test could provision its target EB.
export function interactiveReservedSlots(): number {
  const n = parseInt(process.env.EB_RESERVED_INTERACTIVE_SLOTS || "2", 10);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

interface ClusterCreds {
  host: string;
  port: string;
  token?: string; // bearer token — in-pod SA, or kubeconfig with user.token
  cert?: Buffer; // client cert (mTLS) — kubeconfig with user.client-certificate
  key?: Buffer; // client key (mTLS)
  ca: Buffer;
  namespace: string;
  insecureSkipTLSVerify?: boolean;
}

let cachedCreds: ClusterCreds | null = null;

function loadClusterCreds(): ClusterCreds {
  if (cachedCreds) return cachedCreds;
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || "443";
  if (host) {
    // In-pod: ServiceAccount token mount. Unchanged from before.
    const token = readFileSync(`${SA_PATH}/token`, "utf8").trim();
    const ca = readFileSync(`${SA_PATH}/ca.crt`);
    const namespace =
      process.env.EB_NAMESPACE ||
      readFileSync(`${SA_PATH}/namespace`, "utf8").trim() ||
      "default";
    cachedCreds = { host, port, token, ca, namespace };
    return cachedCreds;
  }
  // Dev fallback: reach the k8s API via the host's kubeconfig. Only used when
  // the SA mount isn't present (i.e. `pnpm dev` on the host against a local
  // k3d cluster). Shells out to kubectl to avoid pulling in a YAML parser —
  // kubectl is already required for k3d.
  cachedCreds = loadKubeconfigCreds();
  return cachedCreds;
}

// Minimal kubeconfig output shape we consume. `kubectl config view --raw
// --minify -o json` returns a single-context config, so clusters/users/contexts
// are length-1 arrays after --minify.
interface KubectlConfigView {
  clusters?: Array<{
    cluster?: {
      server?: string;
      "certificate-authority-data"?: string;
      "insecure-skip-tls-verify"?: boolean;
    };
  }>;
  users?: Array<{
    user?: {
      token?: string;
      "client-certificate-data"?: string;
      "client-key-data"?: string;
    };
  }>;
  contexts?: Array<{ context?: { namespace?: string } }>;
}

function loadKubeconfigCreds(): ClusterCreds {
  let raw: string;
  try {
    raw = execFileSync(
      "kubectl",
      ["config", "view", "--raw", "--minify", "-o", "json"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    throw new Error(
      `EB_PROVISIONER=kubernetes but no in-pod SA token and kubectl config view failed: ${(err as Error).message}. ` +
        `Ensure kubectl is on PATH and the current kube-context points at the target cluster (e.g. 'kubectl config use-context k3d-lastest').`,
    );
  }
  const cfg = JSON.parse(raw) as KubectlConfigView;
  const cluster = cfg.clusters?.[0]?.cluster;
  const user = cfg.users?.[0]?.user;
  const ctx = cfg.contexts?.[0]?.context;
  if (!cluster?.server) {
    throw new Error(
      "kubeconfig has no current cluster.server — check `kubectl config current-context`",
    );
  }
  const url = new URL(cluster.server);
  const host = url.hostname;
  const kcPort = url.port || (url.protocol === "https:" ? "443" : "80");
  const ca = cluster["certificate-authority-data"]
    ? Buffer.from(cluster["certificate-authority-data"], "base64")
    : Buffer.alloc(0);
  const insecureSkipTLSVerify = cluster["insecure-skip-tls-verify"] === true;

  let token: string | undefined;
  let cert: Buffer | undefined;
  let key: Buffer | undefined;
  if (user?.token) {
    token = user.token;
  } else if (user?.["client-certificate-data"] && user?.["client-key-data"]) {
    cert = Buffer.from(user["client-certificate-data"], "base64");
    key = Buffer.from(user["client-key-data"], "base64");
  } else {
    throw new Error(
      "kubeconfig user has neither token nor client-certificate-data — unsupported auth mode",
    );
  }

  const namespace = process.env.EB_NAMESPACE || ctx?.namespace || "default";
  return {
    host,
    port: kcPort,
    token,
    cert,
    key,
    ca,
    namespace,
    insecureSkipTLSVerify,
  };
}

async function k8sRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const creds = loadClusterCreds();
  const payload = body ? JSON.stringify(body) : undefined;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(payload
      ? { "Content-Length": Buffer.byteLength(payload).toString() }
      : {}),
  };
  if (creds.token) headers.Authorization = `Bearer ${creds.token}`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method,
        host: creds.host,
        port: creds.port,
        path,
        ca: creds.ca.length > 0 ? creds.ca : undefined,
        cert: creds.cert,
        key: creds.key,
        rejectUnauthorized: !creds.insecureSkipTLSVerify,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data: unknown = raw;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            /* keep raw */
          }
          resolve({ status: res.statusCode || 0, data });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Minimal slice of a k8s Job object needed to decide liveness. */
export interface K8sJobLike {
  metadata?: { name?: string; deletionTimestamp?: string };
  status?: { succeeded?: number; failed?: number; completionTime?: string };
}

/**
 * A Job counts against pool capacity iff it is not terminal and not being
 * deleted. A just-created Job has an empty status — that counts as live
 * (which is exactly why the k8s API works as the capacity ledger: the Job is
 * visible before its pod registers, so there is no accounting gap and no
 * need for an in-flight counter). Completed/Failed Jobs linger up to
 * `ttlSecondsAfterFinished` (600s, kept long for forensics) and must NOT
 * count — their pod has exited, they hold no resources.
 */
export function isLiveEBJob(job: K8sJobLike): boolean {
  if (job.metadata?.deletionTimestamp) return false;
  const s = job.status;
  if (!s) return true;
  if ((s.succeeded ?? 0) > 0 || (s.failed ?? 0) > 0 || s.completionTime) {
    return false;
  }
  return true;
}

/**
 * Authoritative pool occupancy — the backend IS the ledger:
 *   kubernetes: count of live EB Jobs in the API (visible at creation time)
 *   process:    live children in the provisioner's process map
 * Throws when the k8s list fails: capacity decisions must fail closed, never
 * fall back to a DB count (registered runners lag Job creation by 5–30s —
 * counting them let concurrent callers blow past the cap; observed in prod as
 * 29 EB pods created while the app was restarting).
 *
 * Static-fleet EBs (SYSTEM_EB_TOKEN compose replicas) exist only in mode
 * 'none' where provisioning is disabled, so counting provisioner-owned units
 * only is correct.
 */
export async function livePoolCount(): Promise<number> {
  return (await listEBJobNames()).size;
}

// Non-authoritative cache of livePoolCount for display reads (`GET /v1/pool`).
// Provision decisions always read fresh inside the provision lock.
let _liveCountCache: { value: number; expiresAt: number } | null = null;
const LIVE_COUNT_CACHE_TTL_MS = 3000;

/**
 * Pool size for display. Serves stale-if-available when the ledger is
 * unreachable, `null` when there's nothing cached either — the caller
 * degrades gracefully. NEVER use for provision decisions.
 */
export async function cachedLivePoolCount(): Promise<number | null> {
  if (_liveCountCache && Date.now() < _liveCountCache.expiresAt) {
    return _liveCountCache.value;
  }
  try {
    const value = await livePoolCount();
    _liveCountCache = {
      value,
      expiresAt: Date.now() + LIVE_COUNT_CACHE_TTL_MS,
    };
    return value;
  } catch {
    return _liveCountCache?.value ?? null;
  }
}

/** Keep the display cache responsive across provision/terminate without an
 *  extra ledger round-trip. `value` when the caller knows the new size. */
function refreshLiveCountCache(value?: number): void {
  if (value === undefined) {
    _liveCountCache = null;
  } else {
    _liveCountCache = {
      value,
      expiresAt: Date.now() + LIVE_COUNT_CACHE_TTL_MS,
    };
  }
}

function jobSpec(name: string, instanceId: string): Record<string, unknown> {
  const creds = (() => {
    try {
      return loadClusterCreds();
    } catch {
      return null;
    }
  })();
  const image = process.env.EB_IMAGE || "lastest-embedded-browser:latest";
  const lastestUrl =
    process.env.LASTEST_URL ||
    "http://lastest-app.lastest.svc.cluster.local:3000";
  // Public-facing URL the self-test repo targets (e.g. https://app.lastest.cloud)
  // — used by the executor's rate-limit bypass to recognize "this test is
  // hitting our own platform" when the public URL differs from LASTEST_URL
  // (Olares: internal cluster DNS vs. external envoy hostname). Optional;
  // when unset the bypass falls back to LASTEST_URL only.
  const lastestPublicUrl = process.env.LASTEST_PUBLIC_URL || "";
  const cpuRequest = process.env.EB_CPU_REQUEST || "1000m";
  const cpuLimit = process.env.EB_CPU_LIMIT || "2000m";
  const memRequest = process.env.EB_MEM_REQUEST || "2Gi";
  const memLimit = process.env.EB_MEM_LIMIT || "4Gi";
  const shmSize = process.env.EB_SHM_SIZE || "512Mi";
  const activeDeadline = parseInt(
    process.env.EB_ACTIVE_DEADLINE_SECONDS || "1800",
    10,
  );
  // `ttlSecondsAfterFinished` controls how long k8s keeps the Pod (and its
  // logs) around after the Job completes / fails. Was 60s — too short for
  // forensic investigation when the executor's dead-EB path tags a test as
  // `[EB-dead]`: by the time anyone looks, the pod is GC'd and logs are gone.
  // 600s (10 min) is long enough to grab logs from a recent failure
  // (`getEBPodInfo`) and short enough that Completed pods don't accumulate.
  const ttlSeconds = parseInt(
    process.env.EB_TTL_SECONDS_AFTER_FINISHED || "600",
    10,
  );

  // Per-session bootstrap token — the ONLY credential the pod receives.
  // TTL = the Job's own deadline + grace, so the token cannot outlive the EB.
  // See the primitive in ./common.ts. Fail closed: without a signing key the
  // pod could never register, so refuse to create a Job at all.
  const bootstrapToken = mintBootstrapToken(
    instanceId,
    activeDeadline * 1000 + 300_000,
  );
  if (!bootstrapToken) {
    throw new Error(
      "Cannot mint EB_BOOTSTRAP_TOKEN — ENCRYPTION_KEY is unset or not 64 hex chars in the pool service env. It must match the app's ENCRYPTION_KEY.",
    );
  }

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name,
      namespace: creds?.namespace ?? "lastest",
      labels: { app: "lastest-eb", "lastest.dev/eb-instance": instanceId },
    },
    spec: {
      activeDeadlineSeconds: activeDeadline,
      ttlSecondsAfterFinished: ttlSeconds,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: { app: "lastest-eb", "lastest.dev/eb-instance": instanceId },
        },
        spec: {
          restartPolicy: "Never",
          // Allow enough time for runnerClient.drain() to flush pending
          // test_result / screenshot / network_bodies POSTs after SIGTERM.
          // Must be ≥ drain timeout in index.ts shutdown() (15s) plus headroom.
          terminationGracePeriodSeconds: 60,
          // `/dev/shm` size ≥512Mi is required — default 64Mi crashes Chromium under load
          volumes: [
            {
              name: "dshm",
              emptyDir: { medium: "Memory", sizeLimit: shmSize },
            },
          ],
          containers: [
            {
              name: "embedded-browser",
              image,
              imagePullPolicy: "IfNotPresent",
              env: [
                { name: "LASTEST_URL", value: lastestUrl },
                ...(lastestPublicUrl
                  ? [{ name: "LASTEST_PUBLIC_URL", value: lastestPublicUrl }]
                  : []),
                { name: "EB_BOOTSTRAP_TOKEN", value: bootstrapToken },
                { name: "INSTANCE_ID", value: instanceId },
                { name: "STREAM_PORT", value: "9223" },
                { name: "CDP_PORT", value: "9222" },
                {
                  name: "EB_SETUP_CONTEXT_TTL_MS",
                  value:
                    process.env.EB_SETUP_CONTEXT_TTL_MS ||
                    String(60 * 60 * 1000),
                },
              ],
              ports: [
                { containerPort: 9222, name: "cdp-local" }, // Chromium's own CDP, localhost-only
                { containerPort: 9223, name: "stream" },
                { containerPort: 9224, name: "health" },
                { containerPort: 9232, name: "cdp" }, // TCP proxy exposing CDP across the cluster
              ],
              resources: {
                requests: { cpu: cpuRequest, memory: memRequest },
                limits: { cpu: cpuLimit, memory: memLimit },
              },
              volumeMounts: [{ name: "dshm", mountPath: "/dev/shm" }],
              readinessProbe: {
                httpGet: { path: "/health", port: 9224 },
                initialDelaySeconds: 2,
                periodSeconds: 2,
                failureThreshold: 30,
              },
              livenessProbe: {
                httpGet: { path: "/health", port: 9224 },
                initialDelaySeconds: 15,
                periodSeconds: 10,
                failureThreshold: 3,
              },
            },
          ],
        },
      },
    },
  };
}

function generateInstanceId(): string {
  return `eb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a Kubernetes Job that will start an EB pod.
 * Returns the Job name and the instanceId it was created with.
 * Does NOT wait for the pod to register — caller polls DB for the matching runner.
 */
// Throttle pod creations. With strict 1-job-1-EB, every test triggers a
// fresh pod launch; concurrent launches burst Calico CNI route-table updates
// which briefly disrupt active in-flight pods' network connections.
// Chromium surfaces this as `net::ERR_NETWORK_CHANGED` mid-test → blank
// screenshots. Spacing launches by EB_LAUNCH_INTERVAL_MS (default 500ms)
// gives CNI time to settle before the next pod's network namespace is wired up.
// Set EB_LAUNCH_INTERVAL_MS=0 to disable.
let _launchChain: Promise<void> = Promise.resolve();
async function awaitLaunchSlot(): Promise<void> {
  const intervalMs = parseInt(process.env.EB_LAUNCH_INTERVAL_MS || "500", 10);
  if (intervalMs <= 0) return;
  const prev = _launchChain;
  let release!: () => void;
  _launchChain = new Promise<void>((r) => {
    release = r;
  });
  try {
    await prev;
  } finally {
    setTimeout(release, intervalMs);
  }
}

async function launchEBJob(): Promise<{
  jobName: string;
  instanceId: string;
}> {
  const mode = provisionerMode();
  if (mode === "none") {
    throw new Error("launchEBJob called but EB provisioning is disabled");
  }

  await awaitLaunchSlot();

  const instanceId = generateInstanceId();
  const jobName = instanceId; // instanceId is short enough to use as job name

  if (mode === "process") {
    await launchEBProcess(instanceId);
    return { jobName, instanceId };
  }

  const creds = loadClusterCreds();
  const spec = jobSpec(jobName, instanceId);

  const { status, data } = await k8sRequest(
    "POST",
    `/apis/batch/v1/namespaces/${encodeURIComponent(creds.namespace)}/jobs`,
    spec,
  );
  if (status < 200 || status >= 300) {
    throw new Error(
      `k8s Job create failed: ${status} ${JSON.stringify(data).slice(0, 500)}`,
    );
  }

  return { jobName, instanceId };
}

/** Thrown by `provisionOneEB` when the (purpose-effective) cap is reached.
 *  Carries the numbers so the HTTP layer can render the 409 body. */
export class AtCapacityError extends Error {
  constructor(
    public readonly size: number,
    public readonly cap: number,
  ) {
    super(`EB pool at capacity (${size}/${cap})`);
    this.name = "AtCapacityError";
  }
}

// Serializes decide+create: the next capacity decision must not run until the
// previous Job/child is visible in the ledger (k8s API / process map). This
// is what makes the fresh `livePoolCount()` read race-free — two concurrent
// provisions can't both observe the pre-create count.
let _provisionChain: Promise<void> = Promise.resolve();
async function withProvisionLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _provisionChain;
  let release!: () => void;
  _provisionChain = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export type ProvisionPurpose = "build" | "interactive" | "warm";

/**
 * The single choke point for creating an EB: fresh ledger read → cap check →
 * create, atomic under the provision lock.
 *
 * `purpose` picks the effective cap:
 *   - 'build':  ebPoolMax − EB_RESERVED_INTERACTIVE_SLOTS, so recording/debug/
 *               AI can always provision even when builds saturate the pool
 *   - 'interactive' / 'warm': the full ebPoolMax
 *
 * Throws `AtCapacityError` at the cap; anything else (k8s list/create
 * failure) propagates — capacity decisions fail closed. Note the ledger read
 * excludes the caller's own not-yet-created unit, so the last pool slot is
 * usable (the old counter double-counted the caller's reservation and
 * self-blocked it).
 */
export async function provisionOneEB(
  purpose: ProvisionPurpose,
): Promise<{ jobName: string; instanceId: string }> {
  return withProvisionLock(async () => {
    const cap = await poolMax();
    const reserved = purpose === "build" ? interactiveReservedSlots() : 0;
    const effectiveCap = Math.max(0, cap - reserved);
    const size = await livePoolCount();
    if (size >= effectiveCap) {
      throw new AtCapacityError(size, cap);
    }

    const jobInfo = await launchEBJob();
    refreshLiveCountCache(size + 1);
    console.log(
      `[EB Provisioner] Provisioned ${jobInfo.jobName} (pool size ${size + 1}/${cap}, purpose=${purpose})`,
    );
    return jobInfo;
  });
}

/**
 * Delete a Kubernetes Job (and its Pod).
 * Background propagation so the call returns immediately; kubelet cleans up.
 */
export async function terminateEBJob(jobName: string): Promise<void> {
  refreshLiveCountCache(); // display cache only — next /v1/pool re-reads the ledger
  if (provisionerMode() === "process") {
    await terminateEBProcess(jobName);
    return;
  }
  if (!isKubernetesMode()) return;
  const creds = loadClusterCreds();
  const { status } = await k8sRequest(
    "DELETE",
    `/apis/batch/v1/namespaces/${encodeURIComponent(creds.namespace)}/jobs/${encodeURIComponent(jobName)}?propagationPolicy=Background`,
  );
  if (status !== 200 && status !== 202 && status !== 404) {
    console.warn(
      `[EB Provisioner] Job delete for ${jobName} returned status ${status}`,
    );
    return;
  }
  console.log(`[EB Provisioner] Deleted Job ${jobName}`);
}

/**
 * Forensic helper: fetch the EB pod's status + last N lines of logs after the
 * executor flags it as `[EB-dead]`. Best-effort — every call has a hard 2s
 * timeout per k8s round-trip so it can't stall the dispatcher when the pod is
 * unreachable. Returns `null` if anything goes wrong; the caller already has a
 * generic timeout error to fall back on.
 *
 * Used from `executor.ts`'s per-test timeout to disambiguate OOMKilled vs
 * CNI-flake vs Chromium-crash without forcing users to `kubectl` after the
 * fact. Requires `pods` + `pods/log` RBAC, which the app SA already has
 * (`k8s/embedded-browser-rbac.yaml:24-29`).
 */
export interface EBPodInfo {
  podName: string;
  phase: string; // Pending | Running | Succeeded | Failed | Unknown
  reason?: string; // OOMKilled / Error / Completed / Evicted / ...
  exitCode?: number;
  message?: string; // kubelet-reported reason (e.g. "DeadlineExceeded")
  logs: string; // tail of the container's stdout/stderr
}

export async function getEBPodInfo(
  jobName: string,
  tailLines = 80,
): Promise<EBPodInfo | null> {
  if (provisionerMode() === "process") {
    return getEBProcessInfo(jobName, tailLines);
  }
  if (!isKubernetesMode()) return null;
  try {
    const creds = loadClusterCreds();
    // 1. Resolve the Pod for this Job. Job templates carry the `job-name`
    //    label by default; we add `app=lastest-eb` for filtering and a
    //    per-instance label, but `job-name` is the surest match.
    const listResp = await k8sRequest(
      "GET",
      `/api/v1/namespaces/${encodeURIComponent(creds.namespace)}/pods?labelSelector=${encodeURIComponent(`job-name=${jobName}`)}&limit=1`,
    );
    if (listResp.status < 200 || listResp.status >= 300) return null;
    const items =
      (
        listResp.data as {
          items?: Array<{
            metadata?: { name?: string };
            status?: {
              phase?: string;
              message?: string;
              containerStatuses?: Array<{
                state?: {
                  terminated?: {
                    reason?: string;
                    exitCode?: number;
                    message?: string;
                  };
                };
                lastState?: {
                  terminated?: {
                    reason?: string;
                    exitCode?: number;
                    message?: string;
                  };
                };
              }>;
            };
          }>;
        } | null
      )?.items ?? [];
    if (items.length === 0) return null;
    const pod = items[0]!;
    const podName = pod.metadata?.name;
    if (!podName) return null;

    const cstat = pod.status?.containerStatuses?.[0];
    const terminated = cstat?.state?.terminated ?? cstat?.lastState?.terminated;

    // 2. Fetch tail of pod logs. `previous=false` reads the current container
    //    instance (k8s only retains `previous=true` for restarted containers,
    //    and our EBs have backoffLimit=0 so they don't restart).
    const logsResp = await k8sRequest(
      "GET",
      `/api/v1/namespaces/${encodeURIComponent(creds.namespace)}/pods/${encodeURIComponent(podName)}/log?tailLines=${tailLines}&previous=false`,
    );
    const logsRaw =
      typeof logsResp.data === "string"
        ? logsResp.data
        : logsResp.status >= 200 && logsResp.status < 300
          ? ""
          : `<log fetch failed status=${logsResp.status}>`;

    return {
      podName,
      phase: pod.status?.phase ?? "Unknown",
      reason: terminated?.reason,
      exitCode: terminated?.exitCode,
      message: terminated?.message ?? pod.status?.message,
      logs: logsRaw,
    };
  } catch (err) {
    console.warn(
      "[EB Provisioner] getEBPodInfo failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * List the names of currently-LIVE EB Jobs (terminal and deleting Jobs
 * excluded — see `isLiveEBJob`; the process backend already only lists
 * un-exited children). Doubles as the capacity ledger via `livePoolCount()`
 * and feeds boot-time reconciliation of "phantom" runner rows whose backing
 * Job is gone (e.g. TTL expiry during an app restart when no reaper was
 * running) so we don't hand them out to claimers.
 *
 * THROWS on k8s API failure instead of returning an empty set: an empty set
 * means "no jobs exist" and would make the app-side phantom pruner delete
 * every live runner's rows, and would let capacity checks provision without
 * bound. The HTTP layer turns the throw into a 500, which the app client
 * maps to `null` = "unknown, skip pruning".
 */
export async function listEBJobNames(): Promise<Set<string>> {
  if (provisionerMode() === "process") return listEBProcessNames();
  if (!isKubernetesMode()) return new Set();
  const creds = loadClusterCreds();
  const { status, data } = await k8sRequest(
    "GET",
    `/apis/batch/v1/namespaces/${encodeURIComponent(creds.namespace)}/jobs?labelSelector=${encodeURIComponent("app=lastest-eb")}`,
  );
  if (status < 200 || status >= 300) {
    throw new Error(`k8s Job list failed: ${status}`);
  }
  const items = (data as { items?: K8sJobLike[] } | null)?.items ?? [];
  return new Set(
    items
      .filter(isLiveEBJob)
      .map((j) => j.metadata?.name)
      .filter((n): n is string => !!n),
  );
}

// Build-dispatch in-flight counter. Incremented by `executeViaPoolWorkers`
// before claiming the first EB and decremented after the last test releases.
// While > 0, `ensureWarmPool()` no-ops: the build's `claimOrProvisionPoolEB`
// provisions on demand, so the warm-pool refill that fires after every release
// is pure waste (the spawned warm EB never gets claimed before TTL). Saves
// ~10 EB launches on a 16-test build (`docs/eb-and-setup-plan.md` B1).
let _buildDispatchInFlight = 0;
export function incBuildDispatch(): void {
  _buildDispatchInFlight++;
}
export function decBuildDispatch(): void {
  _buildDispatchInFlight = Math.max(0, _buildDispatchInFlight - 1);
}
export function inBuildDispatch(): number {
  return _buildDispatchInFlight;
}

/**
 * Ensure the pool has at least `warmPoolMin()` idle EBs launched.
 * Counts `online` system EB runners; if the count is below the warm minimum,
 * launches Jobs until it's satisfied (bounded by the global ebPoolMax).
 *
 * Safe to call repeatedly — subsequent calls no-op once the pool is warm.
 * Call on app startup and from the periodic cleanup loop.
 *
 * No-op while a build is dispatching (see `_buildDispatchInFlight`): warm-pool
 * refill that races with on-demand provisioning just wastes pods.
 */
export async function ensureWarmPool(): Promise<number> {
  if (!isDynamicPoolMode()) return 0;
  if (_buildDispatchInFlight > 0) return 0;
  const want = warmPoolMin();
  if (want <= 0) return 0;

  // Count EBs currently online and idle (ready for immediate claim)
  const { db } = await import("@lastest/db");
  const { runners, embeddedSessions } = await import("@lastest/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const idle = await db
    .select({ id: runners.id })
    .from(runners)
    .innerJoin(embeddedSessions, eq(embeddedSessions.runnerId, runners.id))
    .where(
      and(
        eq(runners.isSystem, true),
        eq(runners.type, "embedded"),
        eq(runners.status, "online"),
        eq(embeddedSessions.status, "ready"),
      ),
    );

  const deficit = want - idle.length;
  if (deficit <= 0) return 0;

  // Per-call cap enforcement lives inside provisionOneEB (fresh ledger read
  // under the provision lock) — no racy `cap - size` precompute needed.
  let launched = 0;
  for (let i = 0; i < deficit; i++) {
    try {
      await provisionOneEB("warm");
      launched++;
    } catch (err) {
      if (!(err instanceof AtCapacityError)) {
        console.warn("[EB Provisioner] ensureWarmPool launch failed:", err);
      }
      break;
    }
  }
  if (launched > 0)
    console.log(
      `[EB Provisioner] Warm pool topped up (+${launched}, target ${want})`,
    );
  return launched;
}

/**
 * Pre-launch `targetCount` EB Jobs up front for a build, capped by the global
 * `ebPoolMax` minus what's already in flight. Each launch goes through the
 * shared `awaitLaunchSlot()` throttle so CNI doesn't burst.
 *
 * Different from `ensureWarmPool`: the caller picks the target, and we don't
 * gate on the idle-count deficit — builds know their concurrency, warm pool
 * doesn't. Pair with `incBuildDispatch()` so the per-release warm refill stays
 * suppressed; otherwise we'd double-spawn.
 *
 * Returns the number actually launched (may be less than requested if pool is
 * near cap or any launch throws).
 */
export async function prewarmForBuild(targetCount: number): Promise<number> {
  if (!isDynamicPoolMode()) return 0;
  // Process mode: no prewarm, ever. Each claim provisions on demand, so a
  // 1-test build spawns exactly 1 local Chromium instead of 2 (prewarm racing
  // the on-demand claim while the prewarmed EB was still registering). N
  // parallel workers still get N processes via their own claims, capped by
  // EB_PROCESS_POOL_MAX. Local spawn latency (~2-5s) is the accepted cost —
  // prewarm exists to hide k8s pod cold start (image pull, 5-30s), which
  // local child processes don't have.
  if (provisionerMode() === "process") return 0;
  if (targetCount <= 0) return 0;

  // Builds must respect the interactive reservation here too — prewarming to
  // the full hard cap would let a build occupy the slots reserved for
  // recording/debug before any interactive caller could claim one.
  // provisionOneEB('build') enforces exactly that cap per launch.
  let launched = 0;
  for (let i = 0; i < targetCount; i++) {
    try {
      await provisionOneEB("build");
      launched++;
    } catch (err) {
      if (!(err instanceof AtCapacityError)) {
        console.warn("[EB Provisioner] prewarmForBuild launch failed:", err);
      }
      break;
    }
  }
  if (launched > 0) {
    console.log(
      `[EB Provisioner] Prewarmed ${launched} EB(s) for build (target ${targetCount})`,
    );
  }
  return launched;
}
