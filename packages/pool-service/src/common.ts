/**
 * Pure helpers shared by the app and the EB pool service.
 *
 * This module must stay dependency-free (env + node:crypto only): it is
 * imported by both the Next.js app and the standalone pool-service process,
 * and is the only EB-pool code the app shares with the service besides the
 * HTTP client in `client.ts`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type EBProvisionerMode = "kubernetes" | "process" | "none";

// Cached: the answer can't change within a process lifetime.
let _devCheckoutEBDir: string | null | undefined;

/**
 * Locate `packages/embedded-browser`.
 *
 * Null in production app containers, which ship only a bundled EB dist; those
 * deployments must opt into process mode explicitly (EB_PROVISIONER=process).
 */
export function devCheckoutEBDir(): string | null {
  if (_devCheckoutEBDir !== undefined) return _devCheckoutEBDir;
  const candidates = [
    path.resolve(process.cwd(), "packages/embedded-browser"),
    path.resolve(process.cwd(), "../embedded-browser"),
  ];
  _devCheckoutEBDir =
    candidates.find((dir) =>
      fs.existsSync(path.join(dir, "src", "index.ts")),
    ) ?? null;
  return _devCheckoutEBDir;
}

/**
 * How dynamic EB capacity is provisioned:
 *   'kubernetes' — EB_PROVISIONER=kubernetes: one k8s Job per EB (k3d in dev,
 *                  real cluster in prod).
 *   'process'    — one local child process per EB, spawned by the pool
 *                  service. The zero-config local-dev default: when
 *                  EB_PROVISIONER is unset (or 'none'/'process') AND the repo
 *                  checkout contains packages/embedded-browser sources, this
 *                  mode is active — no cluster, no Docker needed.
 *   'none'       — no dynamic provisioning (static EB fleets only). Reached by
 *                  EB_PROVISIONER=disabled, or by default outside a dev
 *                  checkout (e.g. the Zima app container, where compose
 *                  replicas ARE the fleet).
 *
 * Purely env + checkout-layout; holding a mode does NOT imply this process has
 * infra credentials — only the pool service provisions.
 */
export function provisionerMode(): EBProvisionerMode {
  const raw = (process.env.EB_PROVISIONER || "").trim().toLowerCase();
  if (raw === "kubernetes") return "kubernetes";
  if (raw === "disabled" || raw === "off") return "none";
  if (raw === "process") return "process";
  // unset / 'none' / anything else: process mode when the EB sources are
  // present (dev checkout), otherwise no provisioning.
  return devCheckoutEBDir() ? "process" : "none";
}

/** True when this deployment can provision EB capacity on demand (kubernetes
 *  or process mode) — the general "is there a dynamic pool" predicate. Use
 *  `isKubernetesMode()` only for genuinely k8s-specific behavior. */
export function isDynamicPoolMode(): boolean {
  return provisionerMode() !== "none";
}

/**
 * Whether EBs are provisioned as Kubernetes Jobs (EB_PROVISIONER=kubernetes).
 * Prefer `isDynamicPoolMode()` for "can we provision at all" checks.
 */
export function isKubernetesMode(): boolean {
  return provisionerMode() === "kubernetes";
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

// ── Per-session EB bootstrap tokens ─────────────────────────────────────────
//
// The pool service mints one of these per provisioned Job and injects it as
// `EB_BOOTSTRAP_TOKEN` — replacing the fleet-wide `SYSTEM_EB_TOKEN` that used
// to be inlined into every Job spec. The capacity plane thereby vouches for a
// specific pod ("I created instance X, valid until its deadline"); the app
// verifies the introduction and issues domain credentials (the per-runner
// token) at auto-register. A compromised pod leaks only its own short-lived,
// instance-bound credential, never a fleet secret.
//
// `SYSTEM_EB_TOKEN` remains supported at the endpoints for STATIC fleets
// (docker-compose replicas on Zima have no provisioner to mint per-session
// tokens) — but it is no longer distributed to dynamically provisioned pods.
//
// Wire format (mirrors the stream-grant scheme in src/lib/eb/stream-grant.ts):
//
//     <base64url(JSON {i: instanceId, e: expiryMs})>.<base64url(HMAC-SHA256)>
//
// Key is derived from ENCRYPTION_KEY — the app and the pool service must share
// it (they already do in every deployment; the app needs it for stream grants).

const BOOTSTRAP_KEY_INFO = "eb-bootstrap-token-v1";
const ENCRYPTION_KEY_RE = /^[0-9a-f]{64}$/i;

export interface BootstrapTokenPayload {
  /** Provisioner instanceId the token is bound to (`eb-<ts>-<rand>`). */
  i: string;
  /** Expiry, epoch milliseconds. Sized to the Job's activeDeadlineSeconds —
   *  a token never outlives its EB. */
  e: number;
}

/** Null when ENCRYPTION_KEY is absent/malformed — callers MUST fail closed. */
export function getBootstrapTokenKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY?.trim();
  if (!hex || !ENCRYPTION_KEY_RE.test(hex)) return null;
  return crypto
    .createHmac("sha256", Buffer.from(hex, "hex"))
    .update(BOOTSTRAP_KEY_INFO)
    .digest();
}

export function mintBootstrapToken(
  instanceId: string,
  ttlMs: number,
): string | null {
  const key = getBootstrapTokenKey();
  if (!key) return null;
  const payload: BootstrapTokenPayload = {
    i: instanceId,
    e: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", key)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

/**
 * Verify a bootstrap token and return its payload, or null if the signature
 * is invalid, the token expired, or the payload is malformed.
 */
export function verifyBootstrapToken(
  token: string | null | undefined,
): BootstrapTokenPayload | null {
  if (!token) return null;
  const key = getBootstrapTokenKey();
  if (!key) return null;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = crypto
    .createHmac("sha256", key)
    .update(encoded)
    .digest("base64url");
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  let payload: BootstrapTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload?.i !== "string" || !payload.i) return null;
  if (typeof payload?.e !== "number" || Date.now() > payload.e) return null;
  return payload;
}
