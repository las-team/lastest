#!/usr/bin/env node
/**
 * maestro-app-runner — PoC (issue #197)
 *
 * A throwaway "app runner" that speaks Lastest's EMBEDDED-BROWSER PROTOCOL but,
 * instead of launching Playwright/Chromium, launches **Maestro** mobile flows
 * against a local iOS simulator (or Android emulator).
 *
 * The whole point of the PoC: prove that the host↔runner contract
 * (auto-register + poll /api/ws/runner + POST typed JSON responses) is
 * TRANSPORT- AND ENGINE-AGNOSTIC — the host does not actually care that the
 * `code` it dispatches is Playwright JS. Here we treat `command:run_test`'s
 * `code` payload as **Maestro YAML** and shell out to `maestro test`.
 *
 * Two modes (RUNNER_MODE env):
 *   - "fake" (default): reply to run_test with canned pass + a synthetic
 *     screenshot. Proves the host accepts a non-Playwright runner end to end.
 *   - "real": write the payload code to a .yaml, run `maestro test`, and map
 *     Maestro's debug-output (screenshots + pass/fail) back into the protocol.
 *
 * No containerization. Assumes Maestro is already installed and on PATH, and a
 * simulator is already booted. Deliberately minimal — mirrors only the subset
 * of packages/embedded-browser/src/{runner-client,index}.ts that a run needs.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SimStreamServer } from "./stream.ts";

// ------------------------------ config ------------------------------

const config = {
  serverUrl: (process.env.LASTEST_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  ),
  systemToken: process.env.SYSTEM_EB_TOKEN ?? "",
  pollInterval: parseInt(process.env.POLL_INTERVAL ?? "1000", 10),
  instanceId: process.env.INSTANCE_ID || `maestro-${os.hostname()}`,
  // "fake" | "real"
  mode: (process.env.RUNNER_MODE ?? "fake") as "fake" | "real",
  // Maestro target: "ios" | "android"
  platform: process.env.MAESTRO_PLATFORM ?? "ios",
  // App bundle id under test (real mode passes it to Maestro if the flow omits it)
  appId: process.env.MAESTRO_APP_ID ?? "",
  // The stream endpoint the host stores + the Lastest viewer connects to. When
  // MAESTRO_STREAM=1 the runner actually serves live sim frames here (see
  // stream.ts); otherwise it's a registered-but-unserved placeholder.
  streamPort: parseInt(process.env.STREAM_PORT ?? "9223", 10),
  // Live streaming toggle + the tooling/geometry it needs.
  stream: process.env.MAESTRO_STREAM === "1",
  udid: process.env.MAESTRO_UDID ?? "",
  idbBin: process.env.IDB_BIN ?? "idb",
  ffmpegBin: process.env.FFMPEG_BIN ?? "ffmpeg",
  streamFps: parseInt(process.env.STREAM_FPS ?? "15", 10),
  // iPhone 16: 1178×2556 device px, 393×852 logical points.
  deviceWidth: parseInt(process.env.DEVICE_WIDTH ?? "1178", 10),
  deviceHeight: parseInt(process.env.DEVICE_HEIGHT ?? "2556", 10),
  pointWidth: parseInt(process.env.POINT_WIDTH ?? "393", 10),
  pointHeight: parseInt(process.env.POINT_HEIGHT ?? "852", 10),
};

if (!config.systemToken) {
  console.error("SYSTEM_EB_TOKEN is required");
  process.exit(1);
}

// ------------------------------ protocol types ------------------------------
// Re-declared minimally to avoid cross-package imports (same choice the real
// EB runner-client makes).

interface BaseMessage {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
}

interface RunTestPayload {
  testId: string;
  testRunId: string;
  code: string; // <-- Maestro YAML for us, Playwright JS for the real EB
  codeHash: string;
  targetUrl: string;
  repositoryId?: string;
  viewport?: { width: number; height: number };
  timeout?: number;
}

// ------------------------------ runner client ------------------------------

class MaestroRunnerClient {
  private token = "";
  private runnerId?: string;
  private sessionId?: string;
  private running = false;
  private status: "idle" | "busy" = "idle";
  private currentTask?: string;
  private seenCommandIds = new Set<string>();

  async registerAsSystem(): Promise<boolean> {
    const hostname = os.hostname();
    const body = {
      // These URLs are registered but never served — streaming is out of scope.
      streamUrl: `ws://${hostname}:${config.streamPort}`,
      containerUrl: `http://${hostname}:${config.streamPort}`,
      viewport: { width: 393, height: 852 }, // iPhone 16 points
      instanceId: config.instanceId,
    };
    const res = await fetch(`${config.serverUrl}/api/embedded/auto-register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.systemToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(
        `[register] failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
      return false;
    }
    const data = (await res.json()) as {
      runnerId: string;
      token: string;
      sessionId: string;
    };
    this.runnerId = data.runnerId;
    this.sessionId = data.sessionId;
    this.token = data.token; // per-runner token used for all subsequent calls
    console.log(
      `[register] ok runner=${data.runnerId} session=${data.sessionId}`,
    );
    return true;
  }

  async start(): Promise<void> {
    this.running = true;
    for (let attempt = 1; attempt <= 10; attempt++) {
      if (await this.registerAsSystem()) break;
      if (attempt === 10) throw new Error("registration failed after 10 tries");
      const delay = Math.min(1000 * 2 ** (attempt - 1), 15000);
      console.log(`[register] retry ${attempt}/10 in ${delay}ms`);
      await sleep(delay);
    }
    void this.heartbeatLoop();
  }

  private async heartbeatLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.heartbeat();
      } catch (err) {
        console.error("[heartbeat] error:", err);
      }
      await sleep(this.pollDelay());
    }
  }

  // When busy we still poll (so the host can cancel), but no need to hammer.
  private pollDelay(): number {
    return this.status === "busy" ? 2000 : config.pollInterval;
  }

  private async heartbeat(): Promise<void> {
    const msg: BaseMessage = {
      id: randomUUID(),
      type: "status:heartbeat",
      timestamp: Date.now(),
      payload: {
        status: this.status,
        currentTask: this.currentTask,
        systemInfo: {
          platform: `${os.platform()} ${os.release()}`,
          memory: { used: 0, total: os.totalmem() },
          uptime: os.uptime(),
        },
        disconnect: false,
      },
    };
    const data = await this.post(msg);
    const commands = (data?.commands as BaseMessage[] | undefined) ?? [];
    for (const cmd of commands) {
      void this.handleCommand(cmd);
    }
  }

  /** POST a message; returns parsed JSON body (heartbeat replies carry commands). */
  private async post(
    msg: BaseMessage,
  ): Promise<Record<string, unknown> | null> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["X-Session-ID"] = this.sessionId;
    const res = await fetch(`${config.serverUrl}/api/ws/runner`, {
      method: "POST",
      headers,
      body: JSON.stringify(msg),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
  }

  private async send(msg: BaseMessage): Promise<void> {
    await this.post(msg);
  }

  private async handleCommand(cmd: BaseMessage): Promise<void> {
    // Ack first (host flips the command row pending→claimed on this ack).
    await this.send({
      id: randomUUID(),
      type: "response:command_ack",
      timestamp: Date.now(),
      payload: { commandId: cmd.id },
    }).catch(() => {});

    if (this.seenCommandIds.has(cmd.id)) return;
    this.seenCommandIds.add(cmd.id);

    console.log(`[command] ${cmd.type}`);
    switch (cmd.type) {
      case "command:run_test":
        await this.runTest(cmd);
        break;
      case "command:ping":
        await this.send({
          id: randomUUID(),
          type: "response:pong",
          timestamp: Date.now(),
          payload: { correlationId: cmd.id },
        });
        break;
      case "command:cancel_test":
        // PoC: no-op (Maestro run isn't cancelled mid-flight in the spike).
        console.log("[command] cancel_test (ignored in PoC)");
        break;
      default:
        console.log(`[command] unhandled type: ${cmd.type}`);
    }
  }

  private async runTest(cmd: BaseMessage): Promise<void> {
    const payload = cmd.payload as RunTestPayload;
    this.status = "busy";
    this.currentTask = payload.testId;
    const startedAt = Date.now();

    try {
      const outcome =
        config.mode === "real"
          ? await runMaestro(payload.code)
          : fakeMaestroOutcome();

      // Upload screenshots BEFORE the result (mirrors the real EB ordering so
      // the host has them in the DB when it sees pass/fail).
      for (const shot of outcome.screenshots) {
        await this.send({
          id: randomUUID(),
          type: "response:screenshot",
          timestamp: Date.now(),
          payload: {
            correlationId: cmd.id,
            testRunId: payload.testRunId,
            repositoryId: payload.repositoryId,
            filename: shot.filename,
            data: shot.base64,
            width: shot.width,
            height: shot.height,
            capturedAt: Date.now(),
          },
        });
      }

      await this.send({
        id: randomUUID(),
        type: "response:test_result",
        timestamp: Date.now(),
        payload: {
          correlationId: cmd.id,
          testId: payload.testId,
          testRunId: payload.testRunId,
          repositoryId: payload.repositoryId,
          status: outcome.status,
          durationMs: Date.now() - startedAt,
          screenshotCount: outcome.screenshots.length,
          error: outcome.error,
          logs: outcome.logs,
          consoleErrors: [],
          networkRequests: [],
          totalSteps: outcome.totalSteps,
          lastReachedStep: outcome.lastReachedStep,
        },
      });
      console.log(
        `[run_test] ${payload.testId} → ${outcome.status} (${outcome.screenshots.length} shots)`,
      );
    } catch (err) {
      console.error(`[run_test] ${payload.testId} failed:`, err);
      await this.send({
        id: randomUUID(),
        type: "response:test_result",
        timestamp: Date.now(),
        payload: {
          correlationId: cmd.id,
          testId: payload.testId,
          testRunId: payload.testRunId,
          status: "error",
          durationMs: Date.now() - startedAt,
          screenshotCount: 0,
          error: err instanceof Error ? err.message : String(err),
          logs: [],
        },
      });
    } finally {
      this.status = "idle";
      this.currentTask = undefined;
    }
  }
}

// ------------------------------ Maestro integration ------------------------------

interface MaestroOutcome {
  status: "passed" | "failed" | "error";
  error?: string;
  logs: string[];
  screenshots: {
    filename: string;
    base64: string;
    width: number;
    height: number;
  }[];
  totalSteps: number;
  lastReachedStep: number;
}

/**
 * REAL mode: write the dispatched code as a Maestro flow and run it.
 * Maestro writes screenshots + a junit/result into --debug-output; we scoop up
 * any PNGs it produced and map the exit code to pass/fail.
 */
async function runMaestro(flowYaml: string): Promise<MaestroOutcome> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-poc-"));
  const flowPath = path.join(workDir, "flow.yaml");
  const debugOut = path.join(workDir, "debug");

  // If the flow lacks an appId header, inject one from env so `maestro test`
  // knows which app to drive. Maestro flows begin with `appId: <bundle>`.
  let yaml = flowYaml;
  if (!/^\s*appId\s*:/m.test(yaml) && config.appId) {
    yaml = `appId: ${config.appId}\n---\n${yaml}`;
  }
  fs.writeFileSync(flowPath, yaml, "utf-8");

  const logs: string[] = [];
  const code = await new Promise<number>((resolve) => {
    const proc = spawn(
      "maestro",
      [
        "test",
        "--platform",
        config.platform,
        "--debug-output",
        debugOut,
        // Flat layout (no per-run timestamp subdir) — simpler to scrape for CI.
        "--flatten-debug-output",
        "--format",
        "junit",
        flowPath,
      ],
      // Run from workDir so `takeScreenshot: <name>` PNGs (which Maestro writes
      // relative to cwd) land somewhere we control and can collect.
      { env: process.env, cwd: workDir },
    );
    proc.stdout.on("data", (d) => logs.push(d.toString()));
    proc.stderr.on("data", (d) => logs.push(d.toString()));
    proc.on("close", (c) => resolve(c ?? 1));
    proc.on("error", (e) => {
      logs.push(`spawn error: ${e.message}`);
      resolve(1);
    });
  });

  // `takeScreenshot` PNGs land in cwd (workDir); step/debug PNGs in debugOut.
  const screenshots = [
    ...collectPngs(workDir),
    ...collectPngs(debugOut),
  ].filter(
    // de-dup by filename (debugOut may nest under workDir depending on version)
    (s, i, arr) => arr.findIndex((x) => x.filename === s.filename) === i,
  );
  return {
    status: code === 0 ? "passed" : "failed",
    error: code === 0 ? undefined : `maestro exited ${code}`,
    logs,
    screenshots,
    totalSteps: 0,
    lastReachedStep: 0,
  };
}

/** Recursively collect PNGs Maestro dropped into its debug-output dir. */
function collectPngs(
  dir: string,
): { filename: string; base64: string; width: number; height: number }[] {
  const out: {
    filename: string;
    base64: string;
    width: number;
    height: number;
  }[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectPngs(full));
    } else if (entry.name.toLowerCase().endsWith(".png")) {
      const buf = fs.readFileSync(full);
      out.push({
        filename: sanitizePng(entry.name),
        base64: buf.toString("base64"),
        ...pngSize(buf),
      });
    }
  }
  return out;
}

/** Minimal PNG IHDR width/height read (avoids an image dep in the spike). */
function pngSize(buf: Buffer): { width: number; height: number } {
  // PNG signature is 8 bytes, then IHDR length(4)+type(4), then W(4) H(4).
  if (buf.length >= 24 && buf.toString("ascii", 12, 16) === "IHDR") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

function sanitizePng(name: string): string {
  const base = name.split(/[/\\]/).pop() || "shot.png";
  const safe = base.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return /\.png$/i.test(safe) ? safe : `${safe}.png`;
}

/** FAKE mode: a canned pass + a 1x1 PNG, proving protocol acceptance. */
function fakeMaestroOutcome(): MaestroOutcome {
  // 1x1 transparent PNG
  const onePx =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  return {
    status: "passed",
    logs: ["[fake] canned Maestro pass — no simulator was driven"],
    screenshots: [
      { filename: "fake-step-1.png", base64: onePx, width: 1, height: 1 },
    ],
    totalSteps: 1,
    lastReachedStep: 1,
  };
}

// ------------------------------ util ------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------ sim auto-detection ------------------------------

interface SimInfo {
  udid: string;
  name: string;
  deviceWidth: number;
  deviceHeight: number;
  pointWidth: number;
  pointHeight: number;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout?.on("data", (d) => (out += d.toString()));
    p.on("close", () => resolve(out));
    p.on("error", () => resolve(""));
  });
}

/**
 * Resolve the target simulator without requiring the reviewer to hand-copy a
 * UDID or device dimensions. Uses whatever iOS simulator is currently booted
 * (`simctl`), then reads its exact pixel + point geometry from `idb describe`
 * (falls back to a screenshot's PNG header for the pixel size).
 */
async function detectBootedSim(): Promise<SimInfo | null> {
  const json = await run("xcrun", [
    "simctl",
    "list",
    "devices",
    "booted",
    "-j",
  ]);
  let udid = "";
  let name = "";
  try {
    const parsed = JSON.parse(json) as {
      devices: Record<
        string,
        Array<{ udid: string; name: string; state: string }>
      >;
    };
    for (const rt of Object.keys(parsed.devices)) {
      const booted = parsed.devices[rt]!.find((d) => d.state === "Booted");
      if (booted) {
        udid = booted.udid;
        name = booted.name;
        break;
      }
    }
  } catch {
    /* no booted device */
  }
  if (!udid) return null;

  // Geometry from idb (device px + logical points + density in one call).
  const desc = await run(config.idbBin, ["describe", "--udid", udid, "--json"]);
  try {
    const line = desc.trim().split("\n")[0] ?? "";
    const d = JSON.parse(line) as {
      screen_dimensions?: {
        width: number;
        height: number;
        width_points: number;
        height_points: number;
      };
    };
    const s = d.screen_dimensions;
    if (s?.width && s?.height && s?.width_points && s?.height_points) {
      return {
        udid,
        name,
        deviceWidth: s.width,
        deviceHeight: s.height,
        pointWidth: s.width_points,
        pointHeight: s.height_points,
      };
    }
  } catch {
    /* fall through to defaults below */
  }

  // Fallback: keep the env-configured dimensions if idb didn't return geometry.
  return {
    udid,
    name,
    deviceWidth: config.deviceWidth,
    deviceHeight: config.deviceHeight,
    pointWidth: config.pointWidth,
    pointHeight: config.pointHeight,
  };
}

// ------------------------------ main ------------------------------

const client = new MaestroRunnerClient();
console.log(
  `[startup] maestro-app-runner mode=${config.mode} platform=${config.platform} server=${config.serverUrl} stream=${config.stream}`,
);

// Live streaming: serve sim frames on the same port we register as streamUrl,
// so the Lastest viewer connects straight to us.
let streamServer: SimStreamServer | null = null;

process.on("SIGINT", () => {
  streamServer?.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  streamServer?.stop();
  process.exit(0);
});

async function main(): Promise<void> {
  if (config.stream) {
    // Auto-detect the booted simulator (UDID + geometry) unless MAESTRO_UDID
    // was set explicitly — so the reviewer just boots any sim and runs, without
    // copying a UDID or device dimensions from another machine.
    let udid = config.udid;
    let dims = {
      deviceWidth: config.deviceWidth,
      deviceHeight: config.deviceHeight,
      pointWidth: config.pointWidth,
      pointHeight: config.pointHeight,
    };
    if (!udid) {
      const sim = await detectBootedSim();
      if (!sim) {
        console.error(
          "[startup] MAESTRO_STREAM=1 but no booted simulator found. " +
            'Boot one (e.g. `xcrun simctl boot "iPhone 16"`) or set MAESTRO_UDID.',
        );
        process.exit(1);
      }
      udid = sim.udid;
      dims = sim;
      console.log(
        `[startup] auto-detected sim "${sim.name}" ${udid} ` +
          `(${dims.deviceWidth}x${dims.deviceHeight}px, ${dims.pointWidth}x${dims.pointHeight}pt)`,
      );
    }

    streamServer = new SimStreamServer({
      udid,
      port: config.streamPort,
      ...dims,
      fps: config.streamFps,
      idbBin: config.idbBin,
      ffmpegBin: config.ffmpegBin,
    });
    streamServer.start();
  }

  await client.start();
}

main().catch((err) => {
  console.error("[startup] fatal:", err);
  process.exit(1);
});
