import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgresql://lastest:lastest@localhost:5432/lastest';

// Use globalThis to prevent connection pool exhaustion during Next.js hot reload
const globalForDb = globalThis as unknown as { pgClient: ReturnType<typeof postgres> };

const client = globalForDb.pgClient ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== 'production') {
  globalForDb.pgClient = client;
}

export const db = drizzle(client, { schema });
export const sql = client;
