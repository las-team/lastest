import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The logger's output format is decided at import time from NODE_ENV, so the
 * only honest way to assert the production shape is to boot it in a child
 * process with NODE_ENV=production and read what actually lands on stdout.
 */
function runInProd(body: string): Record<string, unknown>[] {
  // tsx compiles these TS modules to CJS, so the ESM namespace exposes them
  // under `default` — unwrap rather than using named imports.
  const script = `
    const L = await import("@/lib/logger");
    const { logger, getLogger } = L.default ?? L;
    const B = await import("@/lib/logger-console-bridge");
    const { installConsoleBridge } = B.default ?? B;
    ${body}
    // pino's async destination flushes on exit; force it so the child's
    // stdout is complete before we parse it.
    logger.flush();
  `;

  const out = execFileSync(
    process.execPath,
    // `--no-deprecation`: Node's default warning handler writes through
    // `console.error`, and it fires on a later tick — so once the bridge is
    // installed, any deprecation the child's own toolchain happens to emit
    // lands on stdout as an extra pino record and breaks the exact-match
    // assertions below. tsx's `module.register()` does exactly that from Node
    // 26 on (not on CI's Node 24), which made this suite's result depend on
    // the developer's Node version rather than on the bridge.
    [
      "--no-deprecation",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      script,
    ],
    {
      encoding: "utf8",
      cwd: new URL("../..", import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_ENV: "production",
        LOG_LEVEL: "trace",
        NEXT_PUBLIC_GIT_HASH: "abc1234",
      },
    },
  );

  return out
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("logger (production)", () => {
  it("emits one JSON object per line with level, time and base fields", () => {
    const [rec] = runInProd(`logger.info({ buildId: 42 }, "build finished");`);

    expect(rec).toMatchObject({
      level: "info",
      msg: "build finished",
      buildId: 42,
      service: "lastest-app",
      env: "production",
      gitHash: "abc1234",
    });
    expect(typeof rec.time).toBe("string");
    expect(new Date(rec.time as string).getTime()).toBeGreaterThan(0);
    expect(rec.pid).toBeTypeOf("number");
  });

  it("tags child loggers with a scope", () => {
    const [rec] = runInProd(`getLogger("GC").warn("stale runner");`);

    expect(rec).toMatchObject({
      level: "warn",
      scope: "GC",
      msg: "stale runner",
    });
  });

  it("redacts secret-bearing fields", () => {
    const [rec] = runInProd(
      `logger.info({ token: "eb-bootstrap-secret", nested: { apiKey: "sk-live-1" } }, "provisioned");`,
    );

    expect(rec.token).toBe("[redacted]");
    expect((rec.nested as Record<string, unknown>).apiKey).toBe("[redacted]");
    expect(JSON.stringify(rec)).not.toContain("sk-live-1");
  });

  it("honours LOG_LEVEL", () => {
    const recs = runInProd(`
      logger.level = "warn";
      logger.info("dropped");
      logger.error("kept");
    `);

    expect(recs.map((r) => r.msg)).toEqual(["kept"]);
  });
});

describe("console bridge (production)", () => {
  it("maps console methods onto pino levels", () => {
    const recs = runInProd(`
      installConsoleBridge();
      console.log("plain");
      console.info("informative");
      console.warn("careful");
      console.error("broken");
      console.debug("noisy");
    `);

    expect(recs.map((r) => [r.level, r.msg])).toEqual([
      ["info", "plain"],
      ["info", "informative"],
      ["warn", "careful"],
      ["error", "broken"],
      ["debug", "noisy"],
    ]);
  });

  it("lifts a [Prefix] into a scope field", () => {
    const [rec] = runInProd(`
      installConsoleBridge();
      console.log("[CleanupLoop] Started (interval=60000ms)");
    `);

    expect(rec).toMatchObject({
      scope: "CleanupLoop",
      msg: "Started (interval=60000ms)",
    });
  });

  it("serializes Error arguments into err, keeping the stack", () => {
    const [rec] = runInProd(`
      installConsoleBridge();
      console.error("[Boot] startCleanupLoop failed:", new TypeError("nope"));
    `);

    expect(rec).toMatchObject({
      scope: "Boot",
      msg: "startCleanupLoop failed:",
    });
    expect(rec.err).toMatchObject({ type: "TypeError", message: "nope" });
    expect((rec.err as { stack: string }).stack).toContain("TypeError: nope");
  });

  it("applies printf-style formatting like the real console", () => {
    const [rec] = runInProd(`
      installConsoleBridge();
      console.log("deleted %d rows from %s", 3, "runner_commands");
    `);

    expect(rec.msg).toBe("deleted 3 rows from runner_commands");
  });

  it("is idempotent — a second install does not double-wrap", () => {
    const recs = runInProd(`
      installConsoleBridge();
      installConsoleBridge();
      console.log("once");
    `);

    expect(recs.filter((r) => r.msg === "once")).toHaveLength(1);
  });
});
