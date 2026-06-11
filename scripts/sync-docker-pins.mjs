#!/usr/bin/env node
// Sync the hard-coded `.pnpm/<pkg>@<version>` paths in the Dockerfile to the
// versions actually present in `node_modules/.pnpm`.
//
// The runner stage of the Dockerfile copies a handful of serverExternalPackages
// (playwright, tesseract.js, claude-agent-sdk, ws, esbuild, postgres, …) by exact
// pnpm store path because Next's standalone trace prunes them. Every dependency
// bump moves those version-pinned dirs, and a stale pin fails the build deep in
// the `runner` stage with a cryptic "failed to compute cache key … not found".
//
// This rewrites ONLY the version token inside each existing `.pnpm/<token>` path
// (structure untouched), so the result is identical to bumping the pins by hand.
//
// Resolution rules per pin:
//   - exactly one store dir matches `<name>@*`        -> use it (bump if differs)
//   - multiple match and the current pin still exists -> keep it (ambiguous, no-op)
//   - multiple match and the current pin is gone       -> error (human must pick)
//   - zero match                                        -> error (package missing)
//
// Usage: node scripts/sync-docker-pins.mjs [Dockerfile path]   (mutates in place)

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfilePath = resolve(process.argv[2] ?? join(root, "Dockerfile"));
const pnpmDir = join(root, "node_modules", ".pnpm");

const C = {
  red: "\x1b[1;31m",
  green: "\x1b[1;32m",
  yellow: "\x1b[1;33m",
  dim: "\x1b[2m",
  off: "\x1b[0m",
};
const fail = (m) => {
  console.error(`${C.red}✗ sync-docker-pins: ${m}${C.off}`);
  process.exit(1);
};

let storeDirs;
try {
  storeDirs = readdirSync(pnpmDir).filter((n) => {
    try {
      return statSync(join(pnpmDir, n)).isDirectory();
    } catch {
      return false;
    }
  });
} catch {
  fail(`cannot read ${pnpmDir} — run \`pnpm install\` first`);
}

const dockerfile = readFileSync(dockerfilePath, "utf8");

// Every pinned path appears as `.pnpm/<token>` where <token> = <name>@<version>.
// Capture each unique token. Token runs until `/`, whitespace, or end-of-token.
const tokens = new Set();
for (const m of dockerfile.matchAll(/\.pnpm\/([^/\s\\]+@[^/\s\\]+)/g))
  tokens.add(m[1]);

// name = everything up to the first `@` that is followed by a digit (version start).
// Handles scoped/peer-hashed names like `@anthropic-ai+claude-agent-sdk@0.2.141_zod@4.4.3`.
const nameOf = (token) => {
  const m = token.match(/^(.*?)@\d/s);
  return m ? m[1] : token;
};

const replacements = []; // { from, to }
const ambiguous = [];
for (const token of tokens) {
  const name = nameOf(token);
  const candidates = storeDirs.filter((d) => d.startsWith(`${name}@`));
  if (candidates.length === 0)
    fail(`no installed dir for "${name}" (pin "${token}") — store out of sync`);
  if (candidates.includes(token)) continue; // already correct
  if (candidates.length === 1) {
    replacements.push({ from: token, to: candidates[0] });
  } else {
    // current pin gone AND multiple versions present -> can't safely auto-pick
    ambiguous.push({ token, name, candidates });
  }
}

if (ambiguous.length) {
  for (const a of ambiguous)
    console.error(
      `${C.red}✗ "${a.token}" is gone and ${a.name} has multiple versions: ${a.candidates.join(", ")}${C.off}`,
    );
  fail("ambiguous pin(s) — update the Dockerfile by hand");
}

if (replacements.length === 0) {
  console.log(`${C.green}✓ Dockerfile pins already in sync${C.off}`);
  process.exit(0);
}

let out = dockerfile;
for (const { from, to } of replacements) {
  // Anchor on `.pnpm/` so we never touch a version embedded in a peer-hash suffix
  // (e.g. the `_esbuild@x` inside `esbuild-register@…_esbuild@x`).
  const re = new RegExp(
    `(\\.pnpm/)${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[/\\s\\\\]|$)`,
    "g",
  );
  out = out.replace(re, `$1${to}`);
  console.log(
    `${C.yellow}↻ ${from}  ${C.dim}→${C.off}  ${C.yellow}${to}${C.off}`,
  );
}

writeFileSync(dockerfilePath, out);
console.log(
  `${C.green}✓ Synced ${replacements.length} pin(s) in ${dockerfilePath}${C.off}`,
);
