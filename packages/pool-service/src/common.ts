/**
 * Pure helpers shared by the app and the EB pool service.
 *
 * This module must stay dependency-free (env + string logic only): it is
 * imported by both the Next.js app and the standalone pool-service process,
 * and is the only EB-pool code the app shares with the service besides the
 * HTTP client in `pool-client.ts`.
 */

/**
 * Whether dynamic EB provisioning is enabled for this deployment
 * (EB_PROVISIONER=kubernetes). Purely an env check — holding this flag does
 * NOT imply the current process has cluster credentials; only the pool
 * service talks to the Kubernetes API.
 */
export function isKubernetesMode(): boolean {
  return (process.env.EB_PROVISIONER || "none").toLowerCase() === "kubernetes";
}

/**
 * Derive the Job name for a runner row. Only matches runners created by
 * the provisioner's `generateInstanceId()` — `eb-<base36-ts>-<6-char-rand>` —
 * so static sidecar EBs (`eb1`, `eb2`, ...) are NOT misidentified as dynamic
 * Jobs and reaped by `reapIdleEBJobs`.
 */
export function jobNameForRunnerName(runnerName: string): string | null {
  const m = runnerName.match(/^System EB-(eb-[a-z0-9]+-[a-z0-9]+)$/);
  return m ? m[1]! : null;
}
