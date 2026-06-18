import { chromium } from "playwright";

/**
 * Ranger: a deterministic, browser-backed page map. Connects to a provisioned
 * Embedded Browser over CDP, navigates to a URL, lets it render, and extracts a
 * structured map of the LIVE DOM (so SPA/JS content is included — unlike the
 * static `scout`). No AI is involved; this is pure observation. Because it
 * drives the EB's existing page/tab, the EB screencast shows the browse live,
 * which is what makes a ranger run watchable in the activity feed.
 */

export interface RangerPageMap {
  url: string;
  finalUrl: string;
  title: string | null;
  headings: Array<{ level: number; text: string }>;
  landmarks: Array<{ role: string; label: string | null }>;
  forms: Array<{
    name: string | null;
    action: string | null;
    method: string;
    inputs: Array<{
      tag: string;
      type: string | null;
      name: string | null;
      id: string | null;
      label: string | null;
    }>;
  }>;
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  testIds: string[];
  candidateSelectors: string[];
  note: string;
}

export async function browsePageMap(
  cdpUrl: string,
  url: string,
  viewport?: { width: number; height: number },
): Promise<RangerPageMap> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    if (viewport) await page.setViewportSize(viewport).catch(() => {});

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Give SPAs a moment to render past the initial HTML.
    await page
      .waitForLoadState("networkidle", { timeout: 8_000 })
      .catch(() => {});

    const map = (await page.evaluate(() => {
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
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          null
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
        )
          .map(
            (b) =>
              text(b) ||
              b.getAttribute("value") ||
              b.getAttribute("aria-label") ||
              "",
          )
          .filter(Boolean),
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
              `getByRole('button', { name: /${b.slice(0, 40).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/i })`,
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
    })) as Omit<RangerPageMap, "url" | "note">;

    return {
      url,
      ...map,
      note: "Rendered DOM via Embedded Browser (SPA content included). Use these selectors as authoritative for authoring.",
    };
  } finally {
    // Disconnect the CDP client; the EB itself is released by the caller.
    await browser.close().catch(() => {});
  }
}
