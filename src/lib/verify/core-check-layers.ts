import type { CheckLayerDescriptor } from "@lastest/contracts";

/**
 * The 9 check layers core owns directly (RFC §6.3) — everything `CheckLayer`
 * covered before this phase, minus `a11y` and `design`, which are now
 * contributed by `@lastest/plugin-a11y` and
 * `@lastest/plugin-design-system`. Their slots in the canonical order (5 and
 * 6) are why `order` jumps from 4 to 7 below.
 *
 * These stay hand-declared here rather than round-tripping through a plugin
 * manifest because `resolveRegistry`'s `CORE_CHECK_LAYERS` (see
 * `core/kernel/src/registry.ts`) treats their ids as reserved — no plugin
 * may claim them. `network`/`console` in particular have derive logic
 * (`deriveCheckModes` in `check-modes.ts`) too bespoke for the generic
 * `modeField`/`legacyEnabledField` shape (a two-axis legacy fallback), so
 * they — and the rest of the 9 — keep their explicit branches there; this
 * array exists for id/label/icon metadata (the cogwheel dialog, the UI
 * layer-iteration lists) rather than to drive derive logic generically.
 *
 * `wasCaptured`/`delta` are intentionally omitted: board-view.tsx and
 * focus-view.tsx keep their own hardcoded capture-check/delta switch cases
 * for these layers unchanged. Those optional fields exist on
 * `CheckLayerDescriptor` for plugin-contributed layers, whose UI logic
 * genuinely does move out of core.
 */
export const CORE_CHECK_LAYER_DESCRIPTORS: readonly CheckLayerDescriptor[] = [
  {
    id: "visual",
    name: "Visual",
    icon: "Eye",
    description: "Pixel screenshot diff against the baseline.",
    order: 0,
    defaultMode: "enforce",
    alwaysCaptured: true,
    modeField: "visualMode",
  },
  {
    id: "text",
    name: "Text",
    icon: "FileText",
    description:
      "Capture page innerText alongside each screenshot and diff it.",
    order: 1,
    defaultMode: "log",
    modeField: "textMode",
  },
  {
    id: "dom",
    name: "DOM",
    icon: "Code2",
    description: "Capture DOM snapshots and overlay element changes.",
    order: 2,
    defaultMode: "log",
    modeField: "domMode",
    legacyEnabledField: "enableDomDiff",
  },
  {
    id: "network",
    name: "Network",
    icon: "Globe",
    description: "Record HTTP traffic and gate on 4xx/5xx responses.",
    order: 3,
    defaultMode: "enforce",
    modeField: "networkMode",
  },
  {
    id: "console",
    name: "Console",
    icon: "Terminal",
    description:
      "Surface console errors. Capture is always on; mode governs the verdict.",
    order: 4,
    defaultMode: "enforce",
    modeField: "consoleMode",
  },
  {
    id: "perf",
    name: "Perf",
    icon: "Gauge",
    description:
      "Capture Web Vitals (LCP, CLS, TBT) and compare against the baseline.",
    order: 7,
    defaultMode: "log",
    alwaysCaptured: true,
    modeField: "perfMode",
  },
  {
    id: "url",
    name: "URL",
    icon: "Link",
    description: "Compare the trajectory of URLs visited during the test.",
    order: 8,
    defaultMode: "log",
    alwaysCaptured: true,
    modeField: "urlMode",
  },
  {
    id: "api",
    name: "API",
    icon: "Webhook",
    description:
      "Headless HTTP request + response assertions (API-type tests). A failed status/schema/body assertion gates the step.",
    order: 9,
    defaultMode: "enforce",
    modeField: "apiMode",
  },
  {
    id: "storage",
    name: "State",
    icon: "Database",
    description:
      "Diff end-of-run cookies + localStorage against the baseline run. Capture is always on; informational — never fails a test.",
    order: 10,
    defaultMode: "log",
    alwaysCaptured: true,
    modeField: "storageMode",
  },
];
