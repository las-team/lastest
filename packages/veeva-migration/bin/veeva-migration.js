#!/usr/bin/env node
// Thin shim: runs the TypeScript CLI (src/cli.ts) through tsx so the package
// can be consumed as source, like the other workspace packages.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../src/cli.ts");
const tsxCli = require.resolve("tsx/cli");

const child = spawn(process.execPath, [tsxCli, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
