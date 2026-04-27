/**
 * Embedded Browser Provisioner
 *
 * On-demand Kubernetes Job provisioning for system EB pods.
 *
 * Model:
 *   - One Job = one browser = one test (1 test per EB).
 *   - A single build can claim up to `maxParallelEBs` Jobs concurrently.
 *   - Total cluster pool is capped by the global `playwright_settings.ebPoolMax` (default 30).
 *   - Each Job is short-lived. After the worker releases the EB, the Job is
 *     deleted (subject to a small idle-TTL to absorb back-to-back tests).
 *
 * Controlled via env (deployment topology / infra):
 *   EB_PROVISIONER     = 'kubernetes' | 'compose' | 'none'    (default: 'none')
 *   EB_NAMESPACE       = k8s namespace (default: 'lastest')
 *   EB_IMAGE           = container image for the EB
 *   EB_WARM_POOL_MIN   = min EBs to keep alive while idle (default: 2)
 *   EB_CPU_REQUEST / EB_CPU_LIMIT / EB_MEM_REQUEST / EB_MEM_LIMIT
 *   EB_SHM_SIZE        = /dev/shm size (default: '512Mi') — Chromium crash guard
 *   EB_ACTIVE_DEADLINE_SECONDS (default: 1800)
 *   EB_TTL_SECONDS_AFTER_FINISHED (default: 60)
 *   LASTEST_URL        = URL the EB calls back to (default: in-cluster service DNS)
 *   SYSTEM_EB_TOKEN    = shared secret passed to spawned EB
 *
 * Controlled via the global `playwright_settings` row (cluster-wide, DB):
 *   ebPoolMax          = hard cap on concurrent EBs (schema default: 30)
 *   ebIdleTTLSeconds   = idle timeout before a released EB Job is torn down
 *
 * The provisioner is a no-op unless EB_PROVISIONER === 'kubernetes'.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import https from 'https';
import { db } from '@/lib/db';
import { runners } from '@/lib/db/schema';
import { and, eq, ne } from 'drizzle-orm';

const SA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount';

type Mode = 'kubernetes' | 'compose' | 'none';

function provisionerMode(): Mode {
  const m = (process.env.EB_PROVISIONER || 'none').toLowerCase();
  if (m === 'kubernetes' || m === 'compose') return m;
  return 'none';
}

export function isKubernetesMode(): boolean {
  return provisionerMode() === 'kubernetes';
}

// Cluster-wide EB pool limits live in the global `playwright_settings` row.
// Short in-process cache so hot paths (isPoolBusy, claimOrProvisionPoolEB) don't
// hammer the DB — cap changes are rare, pool decisions are frequent.
let _limitsCache: { value: { ebPoolMax: number; ebIdleTTLSeconds: number }; expiresAt: number } | null = null;
const LIMITS_CACHE_TTL_MS = 5000;

async function readPoolLimits(): Promise<{ ebPoolMax: number; ebIdleTTLSeconds: number }> {
  if (_limitsCache && Date.now() < _limitsCache.expiresAt) return _limitsCache.value;
  const { getGlobalPoolLimits } = await import('@/lib/db/queries/settings');
  const row = await getGlobalPoolLimits();
  if (!row) {
    throw new Error(
      'Global playwright_settings row missing — call ensureGlobalPlaywrightSettings() during app boot or create one via the settings UI',
    );
  }
  _limitsCache = { value: row, expiresAt: Date.now() + LIMITS_CACHE_TTL_MS };
  return row;
}

export async function poolMax(): Promise<number> {
  return (await readPoolLimits()).ebPoolMax;
}

export async function ebIdleTTLMs(): Promise<number> {
  return (await readPoolLimits()).ebIdleTTLSeconds * 1000;
}

export function warmPoolMin(): number {
  const n = parseInt(process.env.EB_WARM_POOL_MIN || '2', 10);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

interface ClusterCreds {
  host: string;
  port: string;
  token?: string;          // bearer token — in-pod SA, or kubeconfig with user.token
  cert?: Buffer;           // client cert (mTLS) — kubeconfig with user.client-certificate
  key?: Buffer;            // client key (mTLS)
  ca: Buffer;
  namespace: string;
  insecureSkipTLSVerify?: boolean;
}

let cachedCreds: ClusterCreds | null = null;

function loadClusterCreds(): ClusterCreds {
  if (cachedCreds) return cachedCreds;
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';
  if (host) {
    // In-pod: ServiceAccount token mount. Unchanged from before.
    const token = readFileSync(`${SA_PATH}/token`, 'utf8').trim();
    const ca = readFileSync(`${SA_PATH}/ca.crt`);
    const namespace = process.env.EB_NAMESPACE || readFileSync(`${SA_PATH}/namespace`, 'utf8').trim() || 'default';
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
  clusters?: Array<{ cluster?: { server?: string; 'certificate-authority-data'?: string; 'insecure-skip-tls-verify'?: boolean } }>;
  users?: Array<{ user?: { token?: string; 'client-certificate-data'?: string; 'client-key-data'?: string } }>;
  contexts?: Array<{ context?: { namespace?: string } }>;
}

function loadKubeconfigCreds(): ClusterCreds {
  let raw: string;
  try {
    raw = execFileSync('kubectl', ['config', 'view', '--raw', '--minify', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    throw new Error('kubeconfig has no current cluster.server — check `kubectl config current-context`');
  }
  const url = new URL(cluster.server);
  const host = url.hostname;
  const kcPort = url.port || (url.protocol === 'https:' ? '443' : '80');
  const ca = cluster['certificate-authority-data']
    ? Buffer.from(cluster['certificate-authority-data'], 'base64')
    : Buffer.alloc(0);
  const insecureSkipTLSVerify = cluster['insecure-skip-tls-verify'] === true;

  let token: string | undefined;
  let cert: Buffer | undefined;
  let key: Buffer | undefined;
  if (user?.token) {
    token = user.token;
  } else if (user?.['client-certificate-data'] && user?.['client-key-data']) {
    cert = Buffer.from(user['client-certificate-data'], 'base64');
    key = Buffer.from(user['client-key-data'], 'base64');
  } else {
    throw new Error('kubeconfig user has neither token nor client-certificate-data — unsupported auth mode');
  }

  const namespace = process.env.EB_NAMESPACE || ctx?.namespace || 'default';
  return { host, port: kcPort, token, cert, key, ca, namespace, insecureSkipTLSVerify };
}

async function k8sRequest(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const creds = loadClusterCreds();
  const payload = body ? JSON.stringify(body) : undefined;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
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
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data: unknown = raw;
          try { data = raw ? JSON.parse(raw) : null; } catch { /* keep raw */ }
          resolve({ status: res.statusCode || 0, data });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// In-flight provision counter: the window between `launchEBJob()` creating a
// k8s Job and the pod's `registerAsSystem` callback inserting a runner row is
// 5–30s (image pull, Chromium startup, first heartbeat). During that window
// `currentPoolSize()` used to return a low count because it only sees
// registered runners — so concurrent callers could each think "pool is small,
// safe to provision" and collectively blow past the cap. Observed in prod as
// 29 EB pods created while app was restarting (pool size log stayed at 3/30).
let _inFlightProvisions = 0;
export function incInFlightProvisions(): void { _inFlightProvisions++; }
export function decInFlightProvisions(): void { _inFlightProvisions = Math.max(0, _inFlightProvisions - 1); }
export function inFlightProvisions(): number { return _inFlightProvisions; }

/**
 * Count currently-known system EB runners (online + busy) — proxy for pool size.
 * Offline rows are excluded: they represent dying/dead Jobs awaiting GC and shouldn't
 * block new provisioning. Also includes `_inFlightProvisions` — Jobs that were
 * created but haven't registered yet. Without that, app restarts + burst
 * claims cause runaway provisioning. Used to enforce the global ebPoolMax
 * before provisioning and to decide whether `maybeTerminateReleasedEB` can
 * tear down past warmPoolMin.
 */
export async function currentPoolSize(): Promise<number> {
  const rows = await db
    .select({ id: runners.id })
    .from(runners)
    .where(and(
      eq(runners.isSystem, true),
      eq(runners.type, 'embedded'),
      ne(runners.status, 'offline'),
    ));
  return rows.length + _inFlightProvisions;
}

function jobSpec(name: string, instanceId: string): Record<string, unknown> {
  const creds = (() => { try { return loadClusterCreds(); } catch { return null; } })();
  const image = process.env.EB_IMAGE || 'lastest-embedded-browser:latest';
  const lastestUrl = process.env.LASTEST_URL || 'http://lastest-app.lastest.svc.cluster.local:3000';
  // `SYSTEM_EB_TOKEN` may hold a comma-separated rotation list on the app side
  // (auto-register validates by splitting on `,`). Each EB sends the env var
  // verbatim as its Bearer token, so it must be a SINGLE token or the app 401s
  // every register attempt. Take the first entry — the one the app prefers.
  const systemToken = (process.env.SYSTEM_EB_TOKEN || '').split(',')[0].trim();
  const cpuRequest = process.env.EB_CPU_REQUEST || '1000m';
  const cpuLimit = process.env.EB_CPU_LIMIT || '2000m';
  const memRequest = process.env.EB_MEM_REQUEST || '2Gi';
  const memLimit = process.env.EB_MEM_LIMIT || '4Gi';
  const shmSize = process.env.EB_SHM_SIZE || '512Mi';
  const activeDeadline = parseInt(process.env.EB_ACTIVE_DEADLINE_SECONDS || '1800', 10);
  const ttlSeconds = parseInt(process.env.EB_TTL_SECONDS_AFTER_FINISHED || '60', 10);

  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name,
      namespace: creds?.namespace ?? 'lastest',
      labels: { app: 'lastest-eb', 'lastest.dev/eb-instance': instanceId },
    },
    spec: {
      activeDeadlineSeconds: activeDeadline,
      ttlSecondsAfterFinished: ttlSeconds,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: { app: 'lastest-eb', 'lastest.dev/eb-instance': instanceId },
        },
        spec: {
          restartPolicy: 'Never',
          // Allow enough time for runnerClient.drain() to flush pending
          // test_result / screenshot / network_bodies POSTs after SIGTERM.
          // Must be ≥ drain timeout in index.ts shutdown() (15s) plus headroom.
          terminationGracePeriodSeconds: 60,
          // `/dev/shm` size ≥512Mi is required — default 64Mi crashes Chromium under load
          volumes: [
            { name: 'dshm', emptyDir: { medium: 'Memory', sizeLimit: shmSize } },
          ],
          containers: [
            {
              name: 'embedded-browser',
              image,
              imagePullPolicy: 'IfNotPresent',
              env: [
                { name: 'LASTEST_URL', value: lastestUrl },
                { name: 'SYSTEM_EB_TOKEN', value: systemToken },
                { name: 'INSTANCE_ID', value: instanceId },
                { name: 'STREAM_PORT', value: '9223' },
                { name: 'CDP_PORT', value: '9222' },
                { name: 'EB_SETUP_CONTEXT_TTL_MS', value: process.env.EB_SETUP_CONTEXT_TTL_MS || String(60 * 60 * 1000) },
              ],
              ports: [
                { containerPort: 9222, name: 'cdp-local' }, // Chromium's own CDP, localhost-only
                { containerPort: 9223, name: 'stream' },
                { containerPort: 9224, name: 'health' },
                { containerPort: 9232, name: 'cdp' }, // TCP proxy exposing CDP across the cluster
              ],
              resources: {
                requests: { cpu: cpuRequest, memory: memRequest },
                limits: { cpu: cpuLimit, memory: memLimit },
              },
              volumeMounts: [{ name: 'dshm', mountPath: '/dev/shm' }],
              readinessProbe: {
                httpGet: { path: '/health', port: 9224 },
                initialDelaySeconds: 2,
                periodSeconds: 2,
                failureThreshold: 30,
              },
              livenessProbe: {
                httpGet: { path: '/health', port: 9224 },
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
  const intervalMs = parseInt(process.env.EB_LAUNCH_INTERVAL_MS || '500', 10);
  if (intervalMs <= 0) return;
  const prev = _launchChain;
  let release!: () => void;
  _launchChain = new Promise<void>((r) => { release = r; });
  try {
    await prev;
  } finally {
    setTimeout(release, intervalMs);
  }
}

export async function launchEBJob(): Promise<{ jobName: string; instanceId: string }> {
  if (!isKubernetesMode()) {
    throw new Error('launchEBJob called but EB_PROVISIONER !== "kubernetes"');
  }

  const poolSize = await currentPoolSize();
  const cap = await poolMax();
  if (poolSize >= cap) {
    throw new Error(`EB pool at capacity (${poolSize}/${cap})`);
  }

  await awaitLaunchSlot();

  const instanceId = generateInstanceId();
  const jobName = instanceId; // instanceId is short enough to use as job name
  const creds = loadClusterCreds();
  const spec = jobSpec(jobName, instanceId);

  const { status, data } = await k8sRequest(
    'POST',
    `/apis/batch/v1/namespaces/${encodeURIComponent(creds.namespace)}/jobs`,
    spec,
  );
  if (status < 200 || status >= 300) {
    throw new Error(`k8s Job create failed: ${status} ${JSON.stringify(data).slice(0, 500)}`);
  }

  console.log(`[EB Provisioner] Created Job ${jobName} (pool size ${poolSize + 1}/${cap})`);
  return { jobName, instanceId };
}

/**
 * Delete a Kubernetes Job (and its Pod).
 * Background propagation so the call returns immediately; kubelet cleans up.
 */
export async function terminateEBJob(jobName: string): Promise<void> {
  if (!isKubernetesMode()) return;
  const creds = loadClusterCreds();
  const { status } = await k8sRequest(
    'DELETE',
    `/apis/batch/v1/namespaces/${encodeURIComponent(creds.namespace)}/jobs/${encodeURIComponent(jobName)}?propagationPolicy=Background`,
  );
  if (status !== 200 && status !== 202 && status !== 404) {
    console.warn(`[EB Provisioner] Job delete for ${jobName} returned status ${status}`);
    return;
  }
  console.log(`[EB Provisioner] Deleted Job ${jobName}`);
}

/**
 * Derive the Job name for a runner row. Only matches runners created by
 * `generateInstanceId()` — `eb-<base36-ts>-<6-char-rand>` — so static
 * sidecar EBs (`eb1`, `eb2`, ...) are NOT misidentified as dynamic Jobs
 * and reaped by `reapIdleEBJobs`.
 */
export function jobNameForRunnerName(runnerName: string): string | null {
  const m = runnerName.match(/^System EB-(eb-[a-z0-9]+-[a-z0-9]+)$/);
  return m ? m[1]! : null;
}

/**
 * List the names of currently-existing EB Jobs in the cluster.
 * Used by boot-time reconciliation to detect "phantom" runner rows whose
 * backing Job has been deleted (e.g. TTL expiry during an app restart when
 * no reaper was running) so we don't hand them out to claimers.
 */
export async function listEBJobNames(): Promise<Set<string>> {
  if (!isKubernetesMode()) return new Set();
  const creds = loadClusterCreds();
  const { status, data } = await k8sRequest(
    'GET',
    `/apis/batch/v1/namespaces/${encodeURIComponent(creds.namespace)}/jobs?labelSelector=${encodeURIComponent('app=lastest-eb')}`,
  );
  if (status < 200 || status >= 300) {
    console.warn(`[EB Provisioner] listEBJobNames failed: ${status}`);
    return new Set();
  }
  const items = (data as { items?: Array<{ metadata?: { name?: string } }> } | null)?.items ?? [];
  return new Set(items.map((j) => j.metadata?.name).filter((n): n is string => !!n));
}

/**
 * Ensure the pool has at least `warmPoolMin()` idle EBs launched.
 * Counts `online` system EB runners; if the count is below the warm minimum,
 * launches Jobs until it's satisfied (bounded by the global ebPoolMax).
 *
 * Safe to call repeatedly — subsequent calls no-op once the pool is warm.
 * Call on app startup and from the periodic cleanup loop.
 */
export async function ensureWarmPool(): Promise<number> {
  if (!isKubernetesMode()) return 0;
  const want = warmPoolMin();
  if (want <= 0) return 0;

  // Count EBs currently online and idle (ready for immediate claim)
  const { db } = await import('@/lib/db');
  const { runners, embeddedSessions } = await import('@/lib/db/schema');
  const { and, eq } = await import('drizzle-orm');

  const idle = await db
    .select({ id: runners.id })
    .from(runners)
    .innerJoin(embeddedSessions, eq(embeddedSessions.runnerId, runners.id))
    .where(
      and(
        eq(runners.isSystem, true),
        eq(runners.type, 'embedded'),
        eq(runners.status, 'online'),
        eq(embeddedSessions.status, 'ready'),
      ),
    );

  const deficit = want - idle.length;
  if (deficit <= 0) return 0;

  const cap = await poolMax();
  const size = await currentPoolSize();
  const canLaunch = Math.min(deficit, Math.max(0, cap - size));
  if (canLaunch <= 0) return 0;

  let launched = 0;
  for (let i = 0; i < canLaunch; i++) {
    incInFlightProvisions();
    try {
      await launchEBJob();
      launched++;
      // Decrement scheduled after a grace period: the pod should have
      // registered as a runner by then, so it counts via the DB row instead.
      setTimeout(() => decInFlightProvisions(), 120_000);
    } catch (err) {
      decInFlightProvisions();
      console.warn('[EB Provisioner] ensureWarmPool launch failed:', err);
      break;
    }
  }
  if (launched > 0) console.log(`[EB Provisioner] Warm pool topped up (+${launched}, target ${want})`);
  return launched;
}
