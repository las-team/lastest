// The schema moved to `@lastest/db` (see packages/db/src/schema.ts) so the EB
// pool service can share the table definitions. This shim keeps the historical
// `@/lib/db/schema` import path working for app code — edit the schema THERE,
// then `pnpm db:push` (drizzle.config.ts points at the package).
export * from "@lastest/db/schema";
