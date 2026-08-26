/**
 * Type-level tests for capability narrowing.
 *
 * Self-verifying: each `@ts-expect-error` below fails the build if the error it
 * expects *stops* happening. That is what makes "a plugin that did not declare
 * `browser` gets a type error on `ctx.browser`" a guarantee rather than a
 * comment in the RFC.
 *
 * Checked by `pnpm types` (tsc includes `core/`), not by vitest — there is
 * nothing to run.
 */
import type { PluginContext } from "@lastest/contracts";

import { definePlugin } from "./define";

// ── A plugin that declares `browser` can use it, and only it ────────────────
const explorer = definePlugin({
  id: "explorer",
  title: "Explorer",
  capabilities: ["browser"],
  jobs: {
    "explorer.run": async (ctx) => {
      // Declared → available.
      await ctx.browser.withBrowser({}, async (session) => {
        void session.streamUrl;
      });

      // @ts-expect-error — "ai" was not declared, so it must not be on ctx.
      void ctx.ai;

      // @ts-expect-error — nor may a plugin reach for storage it did not ask for.
      void ctx.storage;
    },
  },
});
void explorer;

// ── `const` inference must keep the union narrow ────────────────────────────
// If the `const` type parameters on definePlugin regressed, `capabilities`
// would widen to CapabilityName[] and every context would get everything —
// silently defeating the design. This asserts it did not.
declare const narrowed: PluginContext<"browser">;
void narrowed.browser;
// @ts-expect-error — a narrowed context must not expose undeclared capabilities.
void narrowed.jobs;

// ── A plugin with no capabilities gets the base context only ────────────────
declare const bare: PluginContext;
void bare.pluginId;
void bare.team;
void bare.log;
// @ts-expect-error — nothing else is reachable.
void bare.browser;

// ── Provider plugins consume a capability core does not supply ──────────────
const consumer = definePlugin({
  id: "consumer",
  title: "Consumer",
  capabilities: ["events"],
  jobs: {
    "consumer.tick": async (ctx) => {
      await ctx.events.emit("consumer.ticked", { at: 1 });
      // @ts-expect-error — still narrowed; `events` does not unlock the rest.
      void ctx.browser;
    },
  },
});
void consumer;
