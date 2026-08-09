import { definePlugin } from "@lastest/kernel";
import type { EventsCapability, ProviderScope } from "@lastest/contracts";

import { eventsHost } from "./wiring";

/**
 * `@lastest/plugin-events` — activity fan-out, as a provider plugin.
 *
 * The direct answer to *"ha több pluginnek is kell egy ilyen fan-out logika,
 * ez is lehet plugin ami etethet más plugin feature-öket"*: any plugin that
 * declares `capabilities: ["events"]` gets this wired in by the kernel without
 * ever importing this package. See `host.ts` for what this plugin does and
 * does not own.
 */
function buildEventsCapability(scope: ProviderScope): EventsCapability {
  const host = eventsHost();
  return {
    async emit(type, payload) {
      await host.emit({
        pluginId: scope.consumerId,
        teamId: scope.team.id,
        repositoryId: scope.repo?.id,
        type,
        payload,
      });
    },
    subscribe(type, fn) {
      return host.subscribe(type, fn);
    },
  };
}

export const eventsPlugin = definePlugin({
  id: "events",
  title: "Events",
  provides: ["events"],
  implement: { events: buildEventsCapability },
});

export default eventsPlugin;

export type { EventsHost, EventsHostEmit } from "./host";
export { configureEvents } from "./wiring";
