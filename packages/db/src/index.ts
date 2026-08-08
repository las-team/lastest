import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { instrumentPostgresClient } from "./tracing";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://lastest:lastest@localhost:5432/lastest";

// Use globalThis to prevent connection pool exhaustion during Next.js hot reload
const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof postgres>;
};

const client =
  globalForDb.pgClient ??
  postgres(connectionString, { max: 10, prepare: false });
if (process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = client;
}

// Traced view of the pool. Wrapping here rather than at each call site is what
// gets both consumers — the Next app and the pool service — in one place, and
// covers reads and writes alike (Drizzle funnels everything through
// `client.unsafe`). Returns `client` itself when tracing is off.
//
// The RAW client is what goes in the hot-reload global above: re-wrapping a
// wrapped client on every reload would stack proxies.
const tracedClient = instrumentPostgresClient(client, connectionString);

export const db = drizzle(tracedClient, { schema });
export const sql = tracedClient;
