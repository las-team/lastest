// The drizzle client + schema moved to the `@lastest/db` workspace package so
// the EB pool service can share them without reaching into app source. This
// shim keeps the historical `@/lib/db` import path working for app code.
export { db, sql } from "@lastest/db";
