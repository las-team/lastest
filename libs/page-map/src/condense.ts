import type { InteractableSnapshot, PageMap } from "./types";

/**
 * Prompt rendering for the two observation shapes.
 *
 * Every list is hard-capped. A page map is attacker-influenced input — a page
 * with ten thousand links would otherwise decide how much of the model's
 * context window this feature gets, and the first thing to fall out of a
 * blown budget is the system prompt's safety rules.
 */

export function condensePageMap(map: PageMap): string {
  const lines: string[] = [
    `URL: ${map.finalUrl || map.url}`,
    `Title: ${map.title ?? "(none)"}`,
  ];
  if (map.headings.length > 0) {
    lines.push(
      `Headings: ${map.headings
        .slice(0, 10)
        .map((h) => `h${h.level} "${h.text.slice(0, 60)}"`)
        .join(", ")}`,
    );
  }
  for (const form of map.forms.slice(0, 6)) {
    const inputs = form.inputs
      .slice(0, 12)
      .map((i) => i.label || i.name || i.id || i.type || i.tag)
      .join(", ");
    lines.push(
      `Form${form.name ? ` "${form.name}"` : ""} (${form.method.toUpperCase()}${form.action ? ` ${form.action}` : ""}): ${inputs}`,
    );
  }
  if (map.buttons.length > 0) {
    lines.push(`Buttons: ${map.buttons.slice(0, 25).join(" | ")}`);
  }
  if (map.links.length > 0) {
    lines.push(
      `Links: ${map.links
        .slice(0, 30)
        .map((l) => `"${l.text.slice(0, 40)}"→${l.href.slice(0, 60)}`)
        .join(", ")}`,
    );
  }
  if (map.testIds.length > 0) {
    lines.push(`Test ids: ${map.testIds.slice(0, 30).join(", ")}`);
  }
  return lines.join("\n");
}

export function describeSnapshot(snap: InteractableSnapshot): string {
  return [
    `URL: ${snap.url}`,
    `Title: ${snap.title}`,
    snap.headings.length > 0 ? `Headings: ${snap.headings.join(" | ")}` : "",
    snap.alerts.length > 0
      ? `Visible alerts/errors: ${snap.alerts.join(" | ")}`
      : "",
    `Interactable elements:\n${snap.items.map((i) => `  ${i}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}
