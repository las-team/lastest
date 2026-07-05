/**
 * Curates a per-step DOM "X-ray" inventory for the share showcase (spec §4).
 * The full per-step element inventory already rides in
 * `ShareData.results[].screenshots[].domSnapshot.elements` (up to ~5000 elements)
 * — this caps it to the handful worth annotating so only a small payload crosses
 * the wire to the client overlay.
 */
import type { DomSnapshotElement, DomDiffResult } from "@/lib/db/schema";

export type XrayRole = "heading" | "region" | "action" | "field" | "other";

export interface XrayElement {
  tag: string;
  role: XrayRole;
  /** Short chip label, e.g. `h1 "See what changed"` or `button "Get started"`. */
  label: string;
  selector: string;
  text: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  /** Pre-labeled (visible without interaction) — the first 2 elements. */
  pinned?: boolean;
}

const LANDMARK_TAGS = new Set(["nav", "main", "header", "footer", "aside"]);
const FIELD_TAGS = new Set(["input", "select", "textarea"]);

function roleFor(tag: string): XrayRole {
  const t = (tag ?? "").toLowerCase();
  if (/^h[1-6]$/.test(t)) return "heading";
  if (LANDMARK_TAGS.has(t)) return "region";
  if (t === "button" || t === "a") return "action";
  if (FIELD_TAGS.has(t)) return "field";
  return "other";
}

function truncate(s: string | undefined, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function labelFor(tag: string, text: string): string {
  const t = truncate(text, 28);
  return t ? `${tag} "${t}"` : tag;
}

function hasArea(el: DomSnapshotElement): boolean {
  const b = el.boundingBox;
  return !!b && b.width > 1 && b.height > 1;
}

// Pick ~8 representative elements: the page's first h1, its top CTAs, a couple of
// form fields, and landmark regions — the elements Lastest tracks per step.
export function buildXrayElements(
  elements: DomSnapshotElement[] | null | undefined,
  max = 8,
): XrayElement[] {
  if (!elements || elements.length === 0) return [];
  const usable = elements.filter(hasArea);
  const byRole = (role: XrayRole) =>
    usable.filter((el) => roleFor(el.tag) === role);

  const heading = byRole("heading").slice(0, 1);
  // Prefer interactive elements that carry visible text (real CTAs over icons).
  const actions = [...byRole("action")]
    .sort(
      (a, b) =>
        (b.textContent?.trim().length ?? 0) -
        (a.textContent?.trim().length ?? 0),
    )
    .slice(0, 3);
  const fields = byRole("field").slice(0, 2);
  const regions = byRole("region").slice(0, 3);

  // Order matters: the first two become pinned (visible without interaction), so
  // lead with the headline + top CTA — the elements a founder recognizes instantly.
  const ordered = [...heading, ...actions, ...fields, ...regions];
  const seen = new Set<string>();
  const out: XrayElement[] = [];
  for (const el of ordered) {
    if (out.length >= max) break;
    const selector = el.selectors?.[0]?.value ?? "";
    const key = selector || `${el.tag}:${el.boundingBox.x},${el.boundingBox.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = (el.textContent ?? "").trim();
    out.push({
      tag: el.tag,
      role: roleFor(el.tag),
      label: labelFor(el.tag, text),
      selector,
      text,
      boundingBox: el.boundingBox,
    });
  }
  for (let i = 0; i < Math.min(2, out.length); i++) out[i].pinned = true;
  return out;
}

// Fallback when a step carries no full inventory: re-frame the inter-run DOM diff
// elements as "live regions we track" so the x-ray is never empty (spec §4.1).
export function buildXrayFromDomDiff(
  dom: DomDiffResult | null | undefined,
  max = 8,
): XrayElement[] {
  if (!dom) return [];
  const els: DomSnapshotElement[] = [
    ...(dom.added ?? []),
    ...(dom.changed ?? []).map((c) => c.current),
    ...(dom.removed ?? []),
  ];
  return buildXrayElements(els, max);
}
