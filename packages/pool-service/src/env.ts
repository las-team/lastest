/**
 * Dev convenience: load `.env.local` before ANY other module reads
 * process.env (the @lastest/db client captures DATABASE_URL at import time).
 * Next.js does this automatically for the app; this standalone process must
 * do it itself. Must be the FIRST import in main.ts.
 *
 * Values never override variables already present in the environment —
 * docker/k8s-injected env always wins. Silently no-ops when the file doesn't
 * exist (production containers).
 */

import fs from "node:fs";
import path from "node:path";

function loadDotenvLocal(): void {
  // cwd is packages/pool-service under `pnpm --filter … dev`, the repo root
  // under direct `node dist/main.mjs` runs — check both.
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../../.env.local"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return;

  let loaded = 0;
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    loaded++;
  }
  if (loaded > 0) {
    console.log(`[PoolService] loaded ${loaded} env var(s) from ${file}`);
  }
}

loadDotenvLocal();
