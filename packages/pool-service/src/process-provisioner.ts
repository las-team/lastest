/**
 * Process-mode EB provisioner — the zero-config local-dev backend.
 *
 * Where kubernetes mode creates one k8s Job per EB, this spawns one local
 * child process per EB running the same `packages/embedded-browser` entry the
 * container image runs. No cluster, no Docker: the EB registers back to the
 * app over `127.0.0.1` exactly like a pod would, holding only its per-session
 * `EB_BOOTSTRAP_TOKEN`.
 *
 * Parity with the k8s backend (same seams, consumed by provisioner.ts):
 *   launch    → spawn child           (Job create)
 *   terminate → SIGTERM, then SIGKILL (Job delete, grace ≈ terminationGracePeriod)
 *   list      → live child names      (Job list, for phantom-row pruning)
 *   info      → state + log ring tail (pod diagnostics for [EB-dead] triage)
 *   deadline  → kill timer            (activeDeadlineSeconds)
 *
 * Each instance gets a block of ports carved from EB_PROCESS_PORT_BASE
 * (default 9300, stride 20): stream=P, health=P+1, cdp=P+2, cdp-proxy=P+12 —
 * the same relative layout the EB derives for itself inside a pod.
 *
 * Env knobs (all optional):
 *   EB_PROCESS_PORT_BASE       first stream port to try (default 9300)
 *   EB_PROCESS_ENTRY           explicit EB entry script (.js run with node,
 *                              .ts with tsx) — overrides auto-detection
 *   EB_ACTIVE_DEADLINE_SECONDS hard kill after this long (default 1800,
 *                              shared with the k8s backend)
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { devCheckoutEBDir, mintBootstrapToken } from "./common";

const PORT_STRIDE = 20;
const LOG_RING_MAX = 500;
// Keep exited records around for diagnostics, mirroring the k8s backend's
// ttlSecondsAfterFinished=600 default.
const EXITED_RECORD_TTL_MS = 600_000;
const KILL_GRACE_MS = 30_000;

interface EBProcess {
  instanceId: string;
  proc: ChildProcess;
  basePort: number;
  startedAt: number;
  logs: string[];
  /** Carry-over for a partial last line between stdout/stderr chunks. */
  logTail: string;
  exited: { code: number | null; signal: string | null; at: number } | null;
  deadlineTimer: ReturnType<typeof setTimeout>;
  killTimer: ReturnType<typeof setTimeout> | null;
}

const processes = new Map<string, EBProcess>();
const reservedBases = new Set<number>();
let exitHookInstalled = false;

function portBase(): number {
  const n = parseInt(process.env.EB_PROCESS_PORT_BASE || "9300", 10);
  return Number.isFinite(n) && n > 0 && n < 65000 ? n : 9300;
}

function activeDeadlineMs(): number {
  const n = parseInt(process.env.EB_ACTIVE_DEADLINE_SECONDS || "1800", 10);
  return (Number.isFinite(n) && n > 0 ? n : 1800) * 1000;
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "0.0.0.0", () => srv.close(() => resolve(true)));
  });
}

/** Reserve a free port block: stream=P, health=P+1, cdp=P+2, proxy=P+12. */
async function allocatePortBlock(): Promise<number> {
  const base = portBase();
  for (let i = 0; i < 200; i++) {
    const candidate = base + i * PORT_STRIDE;
    if (candidate + PORT_STRIDE > 65535) break;
    if (reservedBases.has(candidate)) continue;
    reservedBases.add(candidate); // claim before the async checks — no races
    const checks = await Promise.all(
      [candidate, candidate + 1, candidate + 2, candidate + 12].map(canBind),
    );
    if (checks.every(Boolean)) return candidate;
    reservedBases.delete(candidate);
  }
  throw new Error(
    `no free EB port block found from ${base} (stride ${PORT_STRIDE})`,
  );
}

interface EBEntry {
  command: string;
  args: string[];
  cwd: string;
}

function resolveTsxBin(ebDir: string): string | null {
  for (const dir of [ebDir, path.resolve(ebDir, "..", "..")]) {
    const bin = path.join(dir, "node_modules", ".bin", "tsx");
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

/**
 * Resolve how to start the EB. Order: explicit EB_PROCESS_ENTRY, dev-checkout
 * sources via tsx, a local dist build, then the app-container bundle path
 * (reachable only when a deployment sets EB_PROVISIONER=process explicitly).
 */
export function resolveEBEntry(): EBEntry {
  const explicit = process.env.EB_PROCESS_ENTRY?.trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`EB_PROCESS_ENTRY does not exist: ${explicit}`);
    }
    const cwd = path.dirname(explicit);
    if (explicit.endsWith(".ts")) {
      const tsx = resolveTsxBin(cwd);
      if (!tsx) throw new Error(`no tsx binary found to run ${explicit}`);
      return { command: tsx, args: [explicit], cwd };
    }
    return { command: process.execPath, args: [explicit], cwd };
  }

  const ebDir = devCheckoutEBDir();
  if (ebDir) {
    const src = path.join(ebDir, "src", "index.ts");
    const tsx = resolveTsxBin(ebDir);
    if (tsx) return { command: tsx, args: [src], cwd: ebDir };
    const dist = path.join(ebDir, "dist", "index.js");
    if (fs.existsSync(dist)) {
      return { command: process.execPath, args: [dist], cwd: ebDir };
    }
    throw new Error(
      `cannot run ${src}: no tsx binary and no dist build — run 'pnpm install' (or 'pnpm --filter @lastest/embedded-browser build')`,
    );
  }

  const bundled = "/app/embedded-browser/dist/index.js";
  if (fs.existsSync(bundled)) {
    return {
      command: process.execPath,
      args: [bundled],
      cwd: path.dirname(bundled),
    };
  }
  throw new Error(
    "cannot locate the embedded-browser entry: not a dev checkout, no /app/embedded-browser bundle, and EB_PROCESS_ENTRY is unset",
  );
}

/** Best-effort DX warning when Playwright's browser cache looks empty. */
let warnedNoBrowsers = false;
function warnIfChromiumMissing(): void {
  if (warnedNoBrowsers) return;
  const cacheDir =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(
      process.env.HOME || "/root",
      ".cache",
      "ms-playwright", // Linux default; macOS uses ~/Library/Caches
    );
  try {
    const hasChromium =
      fs.existsSync(cacheDir) &&
      fs.readdirSync(cacheDir).some((d) => d.startsWith("chromium"));
    if (!hasChromium && process.platform === "linux") {
      warnedNoBrowsers = true;
      console.warn(
        "[EB Process] No Playwright Chromium found in " +
          `${cacheDir} — if the EB fails to start, run: ` +
          "pnpm --filter @lastest/embedded-browser exec playwright install chromium",
      );
    }
  } catch {
    /* purely advisory */
  }
}

function appUrl(): string {
  const fromEnv = process.env.LASTEST_URL?.trim();
  // host.k3d.internal only resolves inside the k3d cluster's CoreDNS — a
  // leftover k3d-flow value in .env.local would strand a local process.
  if (fromEnv && !fromEnv.includes("host.k3d.internal")) return fromEnv;
  return `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

function pushLogChunk(rec: EBProcess, chunk: Buffer): void {
  const text = rec.logTail + chunk.toString("utf8");
  const lines = text.split("\n");
  rec.logTail = lines.pop() ?? "";
  for (const line of lines) {
    if (!line) continue;
    rec.logs.push(line);
    console.log(`[EB ${rec.instanceId}] ${line}`);
  }
  if (rec.logs.length > LOG_RING_MAX) {
    rec.logs.splice(0, rec.logs.length - LOG_RING_MAX);
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Children must never outlive the pool service (tsx watch restarts included).
  process.on("exit", () => {
    for (const rec of processes.values()) {
      if (!rec.exited) {
        try {
          rec.proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  });
}

/**
 * Spawn one EB child process for `instanceId`. Resolves once the child is
 * spawned — like the k8s Job create, it does NOT wait for registration; the
 * app polls the DB for the runner row.
 */
export async function launchEBProcess(instanceId: string): Promise<void> {
  const entry = resolveEBEntry();
  warnIfChromiumMissing();

  const deadlineMs = activeDeadlineMs();
  // Same fail-closed rule as the k8s backend: no signing key → no EB.
  const bootstrapToken = mintBootstrapToken(instanceId, deadlineMs + 300_000);
  if (!bootstrapToken) {
    throw new Error(
      "Cannot mint EB_BOOTSTRAP_TOKEN — ENCRYPTION_KEY is unset or not 64 hex chars in the pool service env. It must match the app's ENCRYPTION_KEY.",
    );
  }

  const basePort = await allocatePortBlock();

  // Minimal child env — deliberately NOT process.env: the pool service holds
  // DATABASE_URL and ENCRYPTION_KEY, and an EB must never see either (same
  // no-fleet-secrets rule as dynamically provisioned pods).
  const inherited: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "PLAYWRIGHT_BROWSERS_PATH",
    "NODE_EXTRA_CA_CERTS",
    "CROSS_OS_CONSISTENCY",
    "LASTEST_PUBLIC_URL",
  ]) {
    const v = process.env[key];
    if (v !== undefined) inherited[key] = v;
  }

  const proc = spawn(entry.command, entry.args, {
    cwd: entry.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...inherited,
      // Spelled out because Next's global ProcessEnv augmentation makes
      // NODE_ENV a required property of the env object literal.
      NODE_ENV: process.env.NODE_ENV ?? "development",
      LASTEST_URL: appUrl(),
      EB_BOOTSTRAP_TOKEN: bootstrapToken,
      INSTANCE_ID: instanceId,
      STREAM_PORT: String(basePort),
      CDP_PORT: String(basePort + 2),
      // Register 127.0.0.1 URLs instead of the auto-detected LAN IP — the
      // app, front proxy and EB all share this host.
      STREAM_HOST: "127.0.0.1",
      EB_SETUP_CONTEXT_TTL_MS:
        process.env.EB_SETUP_CONTEXT_TTL_MS || String(60 * 60 * 1000),
    },
  });

  const rec: EBProcess = {
    instanceId,
    proc,
    basePort,
    startedAt: Date.now(),
    logs: [],
    logTail: "",
    exited: null,
    deadlineTimer: setTimeout(() => {
      if (!rec.exited) {
        console.warn(
          `[EB Process] ${instanceId} hit active deadline (${deadlineMs / 1000}s) — terminating`,
        );
        void terminateEBProcess(instanceId);
      }
    }, deadlineMs),
    killTimer: null,
  };
  rec.deadlineTimer.unref?.();

  proc.stdout?.on("data", (c: Buffer) => pushLogChunk(rec, c));
  proc.stderr?.on("data", (c: Buffer) => pushLogChunk(rec, c));
  proc.once("exit", (code, signal) => {
    rec.exited = { code, signal, at: Date.now() };
    clearTimeout(rec.deadlineTimer);
    if (rec.killTimer) clearTimeout(rec.killTimer);
    reservedBases.delete(rec.basePort);
    const uptimeS = Math.round((Date.now() - rec.startedAt) / 1000);
    console.log(
      `[EB Process] ${instanceId} exited (code=${code}, signal=${signal}, uptime=${uptimeS}s)`,
    );
    setTimeout(() => {
      // Only drop the record if it wasn't replaced (ids are unique, but be safe)
      if (processes.get(instanceId) === rec) processes.delete(instanceId);
    }, EXITED_RECORD_TTL_MS).unref?.();
  });
  proc.once("error", (err) => {
    // spawn failure (e.g. ENOENT) — surface it in the ring for diagnostics
    rec.logs.push(`spawn error: ${err.message}`);
    if (!rec.exited) rec.exited = { code: null, signal: null, at: Date.now() };
    reservedBases.delete(rec.basePort);
  });

  processes.set(instanceId, rec);
  installExitHook();
  console.log(
    `[EB Process] Spawned ${instanceId} (pid=${proc.pid}, stream=127.0.0.1:${basePort}, entry=${entry.args[0]})`,
  );
}

/** SIGTERM the child (drain grace mirrors the pod's terminationGracePeriod),
 *  escalating to SIGKILL. Missing/already-exited instances are a no-op. */
export async function terminateEBProcess(instanceId: string): Promise<void> {
  const rec = processes.get(instanceId);
  if (!rec || rec.exited) return;
  try {
    rec.proc.kill("SIGTERM");
  } catch {
    return;
  }
  if (!rec.killTimer) {
    rec.killTimer = setTimeout(() => {
      if (!rec.exited) {
        console.warn(`[EB Process] ${instanceId} ignored SIGTERM — SIGKILL`);
        try {
          rec.proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }, KILL_GRACE_MS);
    rec.killTimer.unref?.();
  }
  console.log(`[EB Process] Terminating ${instanceId}`);
}

/** Names of currently-running EB processes (exited ones excluded — parity
 *  with "does the Job still exist" for phantom-row pruning). */
export function listEBProcessNames(): Set<string> {
  const names = new Set<string>();
  for (const [name, rec] of processes) {
    if (!rec.exited) names.add(name);
  }
  return names;
}

export interface EBProcessInfo {
  podName: string;
  phase: string;
  reason?: string;
  exitCode?: number;
  message?: string;
  logs: string;
}

/** Diagnostics analog of the k8s pod info: state + log-ring tail. */
export function getEBProcessInfo(
  instanceId: string,
  tailLines = 80,
): EBProcessInfo | null {
  const rec = processes.get(instanceId);
  if (!rec) return null;
  const logs = rec.logs.slice(-Math.max(1, tailLines)).join("\n");
  if (!rec.exited) {
    return { podName: instanceId, phase: "Running", logs };
  }
  const { code, signal } = rec.exited;
  return {
    podName: instanceId,
    phase: code === 0 ? "Succeeded" : "Failed",
    reason: signal ?? (code === 0 ? "Completed" : "Error"),
    exitCode: code ?? undefined,
    message: `local process exited (code=${code}, signal=${signal})`,
    logs,
  };
}

/** Terminate every live child — pool-service shutdown path. */
export function terminateAllEBProcesses(): void {
  for (const name of listEBProcessNames()) {
    void terminateEBProcess(name);
  }
}
