/**
 * `@lastest/core-browser/internal` — composition-root only.
 *
 * Everything here would break `core/browser`'s central guarantee if a plugin
 * could reach it: *"notably absent is any way to obtain the CDP URL or the pod
 * address."* That sentence is still true for plugins, and this subpath is how
 * it stays true while `AiCallOptions.browserTools` exists at all.
 *
 * The separation is enforced, not conventional. `@lastest/core-browser/internal`
 * is listed in `FORBIDDEN_PLUGIN_IMPORTS` in
 * `tools/architecture/boundaries.mjs`, so a plugin importing it fails
 * `pnpm arch` and `pnpm lint`. The only legitimate consumer is
 * `src/lib/core/ai-capability.ts`, which needs to turn a plugin-supplied
 * `BrowserSession` into the endpoint `@playwright/mcp` is spawned against —
 * and never hands the string back.
 *
 * If you are adding a second export here, the bar is the same: it must be
 * something the *composition root* needs in order to implement a capability,
 * that a plugin must never see. Anything else belongs on the package root.
 */
export { resolveSessionCdpUrl } from "./browser";
