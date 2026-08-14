/**
 * Types this plugin shares with core rather than owning outright.
 *
 * `BotKind` names the product's own agents, so it lives in
 * `packages/db/src/schema/shared.ts` and core's `createTest(…, createdByAgent)`
 * is typed by it. A plugin may not import `@lastest/db`, so it is restated
 * here and `src/lib/core/gamification-host.ts` carries the `satisfies` clause
 * that fails to compile if the two drift — recipe §6.1's "narrow, don't
 * promote" row, since the type belongs to core.
 *
 * The *rows* keyed by these values (`gamification_bots`) are this plugin's,
 * which is the whole reason the type has to cross the boundary at all.
 */
export type BotKind = "play_agent" | "generate_agent" | "mcp_server";
