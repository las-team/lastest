// PoC helper: enqueue a `command:run_test` for the maestro runner directly in
// the runner_commands table, carrying a Maestro YAML flow as the `code` payload.
// Proves the full host→runner→result round-trip over the EB protocol.
//
// Usage:
//   node dispatch-run-test.mjs <runnerId> [flowPath]
// Requires DATABASE_URL in env (same as the host).

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const runnerId = process.argv[2];
const flowPath =
  process.argv[3] || new URL("../flows/counter.yaml", import.meta.url).pathname;

if (!runnerId) {
  console.error("usage: node dispatch-run-test.mjs <runnerId> [flowPath]");
  process.exit(1);
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const code = readFileSync(flowPath, "utf-8");
const sql = postgres(DATABASE_URL);

const commandId = randomUUID();
const testId = `poc-test-${Date.now()}`;
const testRunId = `poc-run-${Date.now()}`;

const payload = {
  testId,
  testRunId,
  code, // <-- Maestro YAML, not Playwright JS
  codeHash: "poc",
  targetUrl: "app://maestro-poc",
  viewport: { width: 393, height: 852 },
  timeout: 120000,
};

await sql`
  INSERT INTO runner_commands (id, runner_id, type, status, payload, test_id, test_run_id, created_at)
  VALUES (${commandId}, ${runnerId}, 'command:run_test', 'pending',
          ${sql.json(payload)}, ${testId}, ${testRunId}, now())
`;

console.log(`dispatched command:run_test`);
console.log(`  commandId=${commandId}`);
console.log(`  runnerId=${runnerId}`);
console.log(`  testId=${testId}`);
console.log(`  flow=${flowPath}`);

await sql.end();
