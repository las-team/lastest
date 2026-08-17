import { a11yPlugin } from "@lastest/plugin-a11y";
import { apiTestPlugin } from "@lastest/plugin-api-test";
import { appMapPlugin } from "@lastest/plugin-app-map";
import { awardsPlugin } from "@lastest/plugin-awards";
import { ciPlugin } from "@lastest/plugin-ci";
import { dataSourcesPlugin } from "@lastest/plugin-data-sources";
import { designSystemPlugin } from "@lastest/plugin-design-system";
import { eventsPlugin } from "@lastest/plugin-events";
import { explorerPlugin } from "@lastest/plugin-explorer";
import { gamificationPlugin } from "@lastest/plugin-gamification";
import { launchPlugin } from "@lastest/plugin-launch";
import { playgroundPlugin } from "@lastest/plugin-playground";
import { quickstartPlugin } from "@lastest/plugin-quickstart";
import { rangerPlugin } from "@lastest/plugin-ranger";
import { rcaPlugin } from "@lastest/plugin-rca";
import { recorderPlugin } from "@lastest/plugin-recorder";
import { schedulingPlugin } from "@lastest/plugin-scheduling";
import { sharePlugin } from "@lastest/plugin-share";
import type { resolveRegistry } from "@lastest/kernel";

/**
 * Registered plugins. `resolveRegistry` validates the whole set at boot — ids,
 * job-type namespacing, capability providers, check-layer ids, and that every
 * plugin with storage can also delete it.
 *
 * `eventsPlugin` must be listed alongside every plugin that consumes `events`
 * — it is a *provider* plugin (`provides: ["events"]`), not a core capability,
 * per `docs/architecture/core-scope.md` §4. `resolveRegistry` would refuse to
 * boot `explorerPlugin` (which declares `capabilities: ["events"]`) without it.
 *
 * Split out of `runtime.ts` (which is `server-only`) so this list can also be
 * consumed by anything that must stay import-safe outside the server, without
 * pulling in a DB client at module scope. Note this file is still not a place
 * to get *check-layer descriptors* for client UI, though — each plugin here
 * eagerly imports its own `schema`/`deletion` (drizzle-orm and friends), so
 * `src/lib/verify/check-layers.ts` imports plugin `./check-layer` subpaths
 * directly instead of going through this array.
 */
export const MANIFESTS: Parameters<typeof resolveRegistry>[0] = [
  eventsPlugin,
  explorerPlugin,
  designSystemPlugin,
  a11yPlugin,
  rcaPlugin,
  appMapPlugin,
  launchPlugin,
  apiTestPlugin,
  playgroundPlugin,
  gamificationPlugin,
  ciPlugin,
  sharePlugin,
  awardsPlugin,
  rangerPlugin,
  recorderPlugin,
  dataSourcesPlugin,
  schedulingPlugin,
  quickstartPlugin,
];
