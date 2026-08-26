/**
 * `/api/v1/playground/**` — owned by `@lastest/plugin-playground`.
 *
 * The app keeps the URL; the plugin keeps the behaviour. There is nothing to
 * compose on this side — no selected repository, no plan gate, no app UI to
 * hand down — so, like `src/app/api/v1/launch/[...path]/route.ts`, this really
 * is a bare re-export.
 *
 * Written as explicit named re-exports because Next.js discovers route
 * handlers by named export. (Note this is the *route* case, not the S1
 * `"use server"` case: a `"use server"` file that re-exports compiles to a
 * module with no exports — see `plugin-migration-recipe.md` §6.)
 */
export { GET, POST } from "@lastest/plugin-playground/api";

export const dynamic = "force-dynamic";
