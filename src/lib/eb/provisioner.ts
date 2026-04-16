/**
 * Embedded Browser Provisioner
 *
 * On-demand Kubernetes Job provisioning for system EB pods.
 *
 * Model:
 *   - One Job = one browser = one test (1 test per EB).
 *   - A single build can claim up to `maxParallelEBs` Jobs concurrently.
 *   - Total cluster pool is capped at `EB_POOL_MAX` (default 30).
 *   - Each Job is short-lived. After the worker releases the EB, the Job is
 *     deleted (subject to a small idle-TTL to absorb back-to-back tests).
 *
 * Controlled via env:
 *   EB_PROVISIONER     = 'kubernetes' | 'compose' | 'none'    (default: 'none')
 *   EB_NAMESPACE       = k8s namespace (default: 'lastest')
 *   EB_IMAGE           = container image for the EB
 *   EB_POOL_MAX        = hard cap on concurrent EBs (default: 30)
 *   EB_WARM_POOL_MIN   = min EBs to keep alive while idle (default: 0)
 *   EB_CPU_REQUEST / EB_CPU_LIMIT / EB_MEM_REQUEST / EB_MEM_LIMIT
 *   EB_SHM_SIZE        = /dev/shm size (default: '512Mi') — Chromium crash guard
 *   EB_ACTIVE_DEADLINE_SECONDS (default: 1800)
 *   EB_TTL_SECONDS_AFTER_FINISHED (default: 60)
 *   LASTEST_URL        = URL the EB calls back to (default: in-cluster service DNS)
 *   SYSTEM_EB_TOKEN    = shared secret passed to spawned EB
 *
 * The provisioner is a no-op unless EB_PROVISIONER === 'kubernetes'.
 */

import { readFileSync } from 'fs';
import https from 'https';
import { db } from '@/lib/db';
import { runners } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

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

export function poolMax(): number {
  const n = parseInt(process.env.EB_POOL_MAX || '30', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function warmPoolMin(): number {
  const n = parseInt(process.env.EB_WARM_POOL_MIN || '0', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

interface ClusterCreds {
  host: string;
  port: string;
  token: string;
  ca: Buffer;
  namespace: string;
}

let cachedCreds: ClusterCreds | null = null;

function loadClusterCreds(): ClusterCreds {
  if (cachedCreds) return cachedCreds;
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';
  if (!host) {
    throw new Error('KUBERNETES_SERVICE_HOST not set — not running inside a Kubernetes pod');
  }
  const token = readFileSync(`${SA_PATH}/token`, 'utf8').trim();
  const ca = readFileSync(`${SA_PATH}/ca.crt`);
  const namespace = process.env.EB_NAMESPACE || readFileSync(`${SA_PATH}/namespace`, 'utf8').trim() || 'default';
  cachedCreds = { host, port, token, ca, namespace };
  return cachedCreds;
}

async function k8sRequest(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const creds = loadClusterCreds();
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method,
        host: creds.host,
        port: creds.port,
        path,
        ca: creds.ca,
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
        },
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

/**
 * Count currently-known system EB runners (online + busy) — proxy for pool size.
 * Used to enforce EB_POOL_MAX before provisioning.
 */
export async function currentPoolSize(): Promise<number> {
  const rows = await db
    .select({ id: runners.id })
    .from(runners)
    .where(and(eq(runners.isSystem, true), eq(runners.type, 'embedded')));
  return rows.length;
}

function jobSpec(name: string, instanceId: string): Record<string, unknown> {
  const creds = (() => { try { return loadClusterCreds(); } catch { return null; } })();
  const image = process.env.EB_IMAGE || 'lastest-embedded-browser:latest';
  const lastestUrl = process.env.LASTEST_URL || 'http://lastest-app.lastest.svc.cluster.local:3000';
  const systemToken = process.env.SYSTEM_EB_TOKEN || '';
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
              ],
              ports: [
                { containerPort: 9222, name: 'cdp' },
                { containerPort: 9223, name: 'stream' },
                { containerPort: 9224, name: 'health' },
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
export async function launchEBJob(): Promise<{ jobName: string; instanceId: string }> {
  if (!isKubernetesMode()) {
    throw new Error('launchEBJob called but EB_PROVISIONER !== "kubernetes"');
  }

  const poolSize = await currentPoolSize();
  const cap = poolMax();
  if (poolSize >= cap) {
    throw new Error(`EB pool at capacity (${poolSize}/${cap})`);
  }

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
 * Derive the Job name for a runner row. Runner names follow the format
 * `System EB-${instanceId}` and we use instanceId as the job name.
 */
export function jobNameForRunnerName(runnerName: string): string | null {
  const m = runnerName.match(/^System EB-(.+)$/);
  return m ? m[1]! : null;
}
