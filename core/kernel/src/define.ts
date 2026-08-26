import type { CapabilityName, PluginManifest } from "@lastest/contracts";

/**
 * Typed identity function.
 *
 * Exists for inference, not behaviour: it binds `C` so that `ctx` inside every
 * job handler is narrowed to exactly the capabilities the manifest declared. A
 * plugin that did not ask for `"browser"` gets a compile error on `ctx.browser`
 * rather than `undefined` at runtime.
 *
 * `const` type parameters matter here — without them `capabilities: ["browser"]`
 * widens to `CapabilityName[]` and every context gets every capability, quietly
 * defeating the whole point.
 */
export function definePlugin<
  const C extends CapabilityName = never,
  const P extends CapabilityName = never,
>(manifest: PluginManifest<C, P>): PluginManifest<C, P> {
  return manifest;
}
