// Lightweight postgres client for routes that must NOT pull in ./schema
// (which re-exports every table and forces a 2000+ line compile for any
// import). Shares the same `pgClient` global as `./index`, so only one pool
// exists at runtime regardless of which module imported it first.
import postgres from 'postgres';

type PgClient = ReturnType<typeof postgres>;

const connectionString =
  process.env.DATABASE_URL || 'postgresql://lastest:lastest@localhost:5432/lastest';

const globalForDb = globalThis as unknown as { pgClient?: PgClient };

export const sql: PgClient =
  globalForDb.pgClient ?? postgres(connectionString, { max: 10 });

if (process.env.NODE_ENV !== 'production' && !globalForDb.pgClient) {
  globalForDb.pgClient = sql;
}
