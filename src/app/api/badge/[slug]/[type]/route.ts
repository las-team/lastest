/**
 * `GET /api/badge/[slug]/[type]` — owned by `@lastest/plugin-awards`.
 *
 * Bare re-export, the same shape as `src/app/api/v1/launch/[...path]/route.ts`
 * (recipe §6.2): the one core call the handler needs
 * (`AwardsHost.getBuildTotalTests`) is already a host method, so there is
 * nothing left for the app to compose. `dynamic`/`runtime` are declared here
 * rather than re-exported — Next.js requires route-segment config to be
 * literal in the route file itself.
 */
export { GET } from "@lastest/plugin-awards/api/badge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
