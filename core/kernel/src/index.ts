/**
 * `@lastest/kernel` — the plugin registry and context construction.
 *
 * The only piece of core that exists purely because the framework needs it,
 * rather than because it guards tenancy, capacity, money or credentials.
 */
export { definePlugin } from "./define";
export {
  buildContext,
  CORE_CHECK_LAYERS,
  CORE_PROVIDED,
  PLUGIN_ID_RE,
  PluginRegistryError,
  resolveRegistry,
} from "./registry";
export type {
  CapabilityFactories,
  ContextScope,
  ResolvedRegistry,
} from "./registry";
export { createRuntime, UnknownJobTypeError } from "./runtime";
export type {
  JobDispatchRun,
  PluginRuntime,
  RuntimeOptions,
  ScopeRequest,
  ScopeResolver,
} from "./runtime";
