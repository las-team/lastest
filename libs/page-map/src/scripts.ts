import type { InteractableSnapshot, PageMap } from "./types";

/**
 * The two in-page extractors, exported as plain functions rather than as
 * `observe(page)` helpers.
 *
 * That is deliberate. A function passed to `page.evaluate` is serialised and
 * re-parsed inside the browser, so it may not close over anything in this
 * module — which in turn means this file needs no page type at all, and
 * therefore no dependency on Playwright, on `@lastest/contracts`, or on
 * whatever the caller's page happens to be. The caller writes
 * `page.evaluate(pageMapScript)` and keeps its own typing.
 *
 * The practical payoff: the same extraction runs from the app's CDP-connecting
 * `ranger` and from a plugin holding a core-issued page, with one copy of the
 * DOM logic instead of two that drift.
 */

/** Everything a `PageMap` carries except the fields only the caller knows. */
export type ExtractedPageMap = Omit<PageMap, "url" | "note">;

export function pageMapScript(): ExtractedPageMap {
  const text = (el: Element | null): string =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const uniq = (arr: string[]): string[] =>
    Array.from(new Set(arr.filter(Boolean)));

  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .map((h) => ({ level: Number(h.tagName[1]), text: text(h) }))
    .filter((h) => h.text)
    .slice(0, 40);

  const landmarkRoles = [
    "banner",
    "navigation",
    "main",
    "search",
    "contentinfo",
    "complementary",
    "form",
    "region",
  ];
  const landmarks = Array.from(
    document.querySelectorAll(
      "[role],header,nav,main,aside,footer,form,section",
    ),
  )
    .map((el) => {
      const role =
        el.getAttribute("role") ||
        ({
          HEADER: "banner",
          NAV: "navigation",
          MAIN: "main",
          ASIDE: "complementary",
          FOOTER: "contentinfo",
          FORM: "form",
          SECTION: "region",
        }[el.tagName] ??
          "");
      return {
        role,
        label:
          el.getAttribute("aria-label") ||
          el.getAttribute("aria-labelledby") ||
          null,
      };
    })
    .filter((l) => landmarkRoles.includes(l.role))
    .slice(0, 20);

  const labelFor = (el: Element): string | null => {
    const id = el.getAttribute("id");
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) return text(lab);
    }
    return (
      el.getAttribute("aria-label") || el.getAttribute("placeholder") || null
    );
  };

  const forms = Array.from(document.querySelectorAll("form"))
    .slice(0, 10)
    .map((f) => ({
      name: f.getAttribute("name") || f.getAttribute("id"),
      action: f.getAttribute("action"),
      method: (f.getAttribute("method") || "get").toLowerCase(),
      inputs: Array.from(f.querySelectorAll("input,textarea,select"))
        .slice(0, 30)
        .map((i) => ({
          tag: i.tagName.toLowerCase(),
          type: i.getAttribute("type"),
          name: i.getAttribute("name"),
          id: i.getAttribute("id"),
          label: labelFor(i),
        })),
    }));

  const buttons = uniq(
    Array.from(
      document.querySelectorAll(
        "button,[role=button],input[type=submit],input[type=button]",
      ),
    ).map(
      (b) =>
        text(b) ||
        b.getAttribute("value") ||
        b.getAttribute("aria-label") ||
        "",
    ),
  ).slice(0, 40);

  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => ({
      text: text(a),
      href: (a as HTMLAnchorElement).getAttribute("href") || "",
    }))
    .filter((l) => l.href && !l.href.startsWith("javascript:"))
    .slice(0, 80);

  const testIds = uniq(
    Array.from(document.querySelectorAll("[data-testid]")).map(
      (e) => e.getAttribute("data-testid") || "",
    ),
  ).slice(0, 50);

  const candidateSelectors = uniq([
    ...testIds.map((t) => `getByTestId('${t}')`),
    ...buttons
      .slice(0, 12)
      .map(
        (b) =>
          `getByRole('button', { name: /${b
            .slice(0, 40)
            .replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/i })`,
      ),
  ]).slice(0, 50);

  return {
    title: document.title || null,
    finalUrl: location.href,
    headings,
    landmarks,
    forms,
    buttons,
    links,
    testIds,
    candidateSelectors,
  };
}

/** `InteractableSnapshot` minus `url`, which the caller reads off the page. */
export type ExtractedSnapshot = Omit<InteractableSnapshot, "url">;

/**
 * The acting-agent snapshot: visible interactables, current headings, and any
 * alert/validation text on screen.
 *
 * Visibility filtering is what separates this from `pageMapScript`. A survey
 * wants everything in the document; a driving loop must not be told to click a
 * control that is behind a closed menu, because it will burn a turn finding out.
 */
export function interactableSnapshotScript(): ExtractedSnapshot {
  const text = (el: Element | null): string =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const vis = (el: Element): boolean => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const sel = (el: Element): string => {
    const id = el.getAttribute("id");
    if (id) return `#${CSS.escape(id)}`;
    const tid = el.getAttribute("data-testid");
    if (tid) return `[data-testid="${tid}"]`;
    const name = el.getAttribute("name");
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
    const t = text(el).slice(0, 40);
    if (t) return `text=${t}`;
    return el.tagName.toLowerCase();
  };
  const items: string[] = [];
  document
    .querySelectorAll(
      "a[href],button,[role=button],input,select,textarea,[role=tab],[role=menuitem],[role=checkbox]",
    )
    .forEach((el) => {
      if (items.length >= 60 || !vis(el)) return;
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type");
      const label =
        text(el) ||
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("value") ||
        "";
      items.push(
        `${tag}${type ? `[${type}]` : ""} "${label.slice(0, 50)}" → ${sel(el)}`,
      );
    });
  const headings = Array.from(document.querySelectorAll("h1,h2"))
    .map((h) => text(h))
    .filter(Boolean)
    .slice(0, 6);
  const alerts = Array.from(
    document.querySelectorAll(
      '[role=alert],.error,.alert,[aria-invalid="true"]',
    ),
  )
    .map((e) => text(e))
    .filter(Boolean)
    .slice(0, 6);
  return { items, headings, alerts, title: document.title };
}

/** Just the h1/h2 pairs — the page-state identity signal, cheap to re-read. */
export function headingsScript(): Array<{ level: number; text: string }> {
  return Array.from(document.querySelectorAll("h1,h2")).map((h) => ({
    level: Number(h.tagName[1]),
    text: (h.textContent ?? "").replace(/\s+/g, " ").trim(),
  }));
}
