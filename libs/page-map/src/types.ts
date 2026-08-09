/**
 * The shape of a rendered-DOM page map.
 *
 * Named `PageMap` here rather than `RangerPageMap`: it was the `ranger`
 * feature's type, but `explorer` consumed it too, and a plugin importing
 * another plugin's type is exactly the `cross-plugin` violation the boundary
 * rules exist to stop. Shared *pure* shapes like this are a library, not core
 * (`docs/architecture/core-scope.md` §3) — it holds no secret, gates no spend
 * and cannot exhaust anything.
 */

export interface PageMapHeading {
  level: number;
  text: string;
}

export interface PageMapInput {
  tag: string;
  type: string | null;
  name: string | null;
  id: string | null;
  label: string | null;
}

export interface PageMapForm {
  name: string | null;
  action: string | null;
  method: string;
  inputs: PageMapInput[];
}

export interface PageMapLink {
  text: string;
  href: string;
}

export interface PageMap {
  url: string;
  finalUrl: string;
  title: string | null;
  headings: PageMapHeading[];
  landmarks: Array<{ role: string; label: string | null }>;
  forms: PageMapForm[];
  buttons: string[];
  links: PageMapLink[];
  testIds: string[];
  candidateSelectors: string[];
  note: string;
}

/**
 * A live page snapshot for an agent that is *acting*, not surveying.
 *
 * Distinct from `PageMap` on purpose: it is re-taken every turn, so it is
 * capped much harder, and it carries the two things a driving loop needs and a
 * survey does not — visible-only elements and any alert/validation text the app
 * is currently showing.
 */
export interface InteractableSnapshot {
  url: string;
  title: string;
  items: string[];
  headings: string[];
  alerts: string[];
}
