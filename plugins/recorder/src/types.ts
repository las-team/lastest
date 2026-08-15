/**
 * Small types the plugin used to reach through `@/lib/playwright/types` and
 * `@lastest/db/schema`. Both sources are core; these shapes are simple enough
 * (an 8-line union, a 3-field interface, a 14-row default table) that copying
 * them is cheaper and more honest than a `satisfies`-narrowed re-declaration
 * (recipe §6.1) — there is nothing left to narrow *out* of a 3-field type.
 * `getPlaywrightSettings` on the host returns a `selectorPriority` already
 * defaulted to `DEFAULT_SELECTOR_PRIORITY`, so the plugin never needs the
 * core copy of the constant.
 */

export type SelectorType =
  | "data-testid"
  | "id"
  | "role-name"
  | "label"
  | "heading-context"
  | "text"
  | "aria-label"
  | "placeholder"
  | "name"
  | "alt-text"
  | "title"
  | "css-path"
  | "ocr-text"
  | "coords";

export interface SelectorConfig {
  type: SelectorType;
  enabled: boolean;
  priority: number;
}

/** Mirrors `packages/db/src/schema/shared.ts`'s `DEFAULT_SELECTOR_PRIORITY`. */
export const DEFAULT_SELECTOR_PRIORITY: SelectorConfig[] = [
  { type: "data-testid", enabled: true, priority: 1 },
  { type: "id", enabled: true, priority: 2 },
  { type: "role-name", enabled: true, priority: 3 },
  { type: "label", enabled: true, priority: 4 },
  { type: "heading-context", enabled: true, priority: 5 },
  { type: "aria-label", enabled: true, priority: 6 },
  { type: "text", enabled: true, priority: 7 },
  { type: "placeholder", enabled: true, priority: 8 },
  { type: "name", enabled: true, priority: 9 },
  { type: "alt-text", enabled: true, priority: 10 },
  { type: "title", enabled: true, priority: 11 },
  { type: "css-path", enabled: true, priority: 12 },
  { type: "ocr-text", enabled: false, priority: 13 },
  { type: "coords", enabled: true, priority: 14 },
];

export type AssertionType =
  | "pageLoad"
  | "networkIdle"
  | "urlMatch"
  | "domContentLoaded";

export type WaitType = "duration" | "selector";
export type WaitSelectorCondition = "visible" | "hidden";

export interface WaitParams {
  waitType: WaitType;
  durationMs?: number;
  selector?: string;
  selectors?: Array<{ type: string; value: string }>;
  condition?: WaitSelectorCondition;
  timeoutMs?: number;
}
