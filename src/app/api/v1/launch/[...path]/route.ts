/**
 * `/api/v1/launch/**` — owned by `@lastest/plugin-launch`.
 *
 * The app keeps the URL; the plugin keeps the behaviour. There is nothing to
 * compose on this side — no selected repository, no plan gate, no app UI to
 * hand down — so unlike `src/app/(app)/explorer/page.tsx` this really is a
 * bare re-export.
 *
 * Written as explicit named re-exports because Next.js discovers route
 * handlers by named export. (Note this is the *route* case, not the S1
 * `"use server"` case: a `"use server"` file that re-exports compiles to a
 * module with no exports — see `plugin-migration-recipe.md` §6.)
 */
export { GET, POST, DELETE, PATCH } from "@lastest/plugin-launch/api";

export const dynamic = "force-dynamic";
