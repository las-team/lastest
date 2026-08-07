import { describe, it, expect } from "vitest";
import { SharedFrontier, dedupeRichestByCanonical } from "./explore";
import type { QaPageSnapshot } from "@/lib/db/schema";

const ORIGIN = "https://app.test";

function frontier(overrides: Record<string, unknown> = {}) {
  return new SharedFrontier({
    origin: ORIGIN,
    strategy: "breadth",
    maxDepth: 6,
    pageBudget: 40,
    explorers: 2,
    ...overrides,
  });
}

function snapshot(overrides: Partial<QaPageSnapshot> = {}): QaPageSnapshot {
  return {
    url: `${ORIGIN}/`,
    finalUrl: `${ORIGIN}/`,
    title: null,
    headings: [],
    forms: [],
    buttons: [],
    links: [],
    testIds: [],
    candidateSelectors: [],
    apiEndpoints: [],
    ...overrides,
  };
}

describe("SharedFrontier", () => {
  it("dedupes on normalized href — the same URL never enqueues twice", () => {
    const f = frontier();
    expect(f.add(`${ORIGIN}/a`, 1)).toBe(true);
    expect(f.add(`${ORIGIN}/a`, 1)).toBe(false);
    expect(f.add(`${ORIGIN}/a#section`, 1)).toBe(false); // hash-stripped dupe
    expect(f.pendingCount).toBe(1);
  });

  it("rejects foreign origins, assets, and over-depth URLs", () => {
    const f = frontier({ maxDepth: 2 });
    expect(f.add("https://elsewhere.test/x", 1)).toBe(false);
    expect(f.add(`${ORIGIN}/logo.png`, 1)).toBe(false);
    expect(f.add(`${ORIGIN}/deep`, 3)).toBe(false);
    expect(f.add(`${ORIGIN}/ok`, 2)).toBe(true);
  });

  it("resolves relative hrefs against the discovering page", () => {
    const f = frontier();
    expect(f.add("/relative", 1)).toBe(true);
    expect(f.add("child", 1, `${ORIGIN}/section/`)).toBe(true);
    const urls = [f.next(0)!.url, f.next(0)!.url].sort();
    expect(urls).toEqual([`${ORIGIN}/relative`, `${ORIGIN}/section/child`]);
  });

  it("caps concrete URLs per canonical path (id-fanout protection)", () => {
    const f = frontier();
    expect(f.add(`${ORIGIN}/orders/1`, 1)).toBe(true);
    expect(f.add(`${ORIGIN}/orders/2`, 1)).toBe(true);
    expect(f.add(`${ORIGIN}/orders/3`, 1)).toBe(false); // 3rd /orders/:id
    expect(f.add(`${ORIGIN}/orders`, 1)).toBe(true); // different canonical
  });

  it("partitions first path segments round-robin across explorers", () => {
    const f = frontier({ explorers: 2 });
    f.add(`${ORIGIN}/alpha/1`, 1); // segment alpha → explorer 0
    f.add(`${ORIGIN}/beta/1`, 1); // segment beta → explorer 1
    f.add(`${ORIGIN}/alpha/2`, 1); // alpha again → explorer 0
    expect(f.next(0)!.url).toBe(`${ORIGIN}/alpha/1`);
    expect(f.next(1)!.url).toBe(`${ORIGIN}/beta/1`);
    expect(f.next(0)!.url).toBe(`${ORIGIN}/alpha/2`);
  });

  it("work-steals from another queue when its own is empty", () => {
    const f = frontier({ explorers: 2 });
    f.add(`${ORIGIN}/alpha/1`, 1); // owner: explorer 0
    f.add(`${ORIGIN}/alpha/2`, 1); // owner: explorer 0
    // Explorer 1 owns nothing but must not idle.
    expect(f.next(1)).not.toBeNull();
    expect(f.next(1)).not.toBeNull();
    expect(f.next(1)).toBeNull();
  });

  it("orders by strategy: breadth = FIFO, depth = LIFO", () => {
    const breadth = frontier({ strategy: "breadth", explorers: 1 });
    breadth.add(`${ORIGIN}/first`, 1);
    breadth.add(`${ORIGIN}/second`, 2);
    expect(breadth.next(0)!.url).toBe(`${ORIGIN}/first`);

    const depth = frontier({ strategy: "depth", explorers: 1 });
    depth.add(`${ORIGIN}/first`, 1);
    depth.add(`${ORIGIN}/second`, 2);
    expect(depth.next(0)!.url).toBe(`${ORIGIN}/second`);
  });

  it("balanced alternates between FIFO and LIFO", () => {
    const f = frontier({ strategy: "balanced", explorers: 1 });
    f.add(`${ORIGIN}/a`, 1);
    f.add(`${ORIGIN}/b`, 1);
    f.add(`${ORIGIN}/c`, 1);
    const first = f.next(0)!.url;
    const second = f.next(0)!.url;
    expect(first).toBe(`${ORIGIN}/a`); // toggle → FIFO
    expect(second).toBe(`${ORIGIN}/c`); // toggle → LIFO
  });

  it("stops serving once mapped + in-flight reaches the page budget", () => {
    const f = frontier({ pageBudget: 2, explorers: 1 });
    f.add(`${ORIGIN}/a`, 1);
    f.add(`${ORIGIN}/b`, 1);
    f.add(`${ORIGIN}/c`, 1);
    expect(f.next(0)).not.toBeNull(); // in-flight 1
    expect(f.next(0)).not.toBeNull(); // in-flight 2 = budget
    expect(f.next(0)).toBeNull();
    expect(f.budgetReached()).toBe(true);
  });

  it("a failed page returns its budget slot", () => {
    const f = frontier({ pageBudget: 1, explorers: 1 });
    f.add(`${ORIGIN}/a`, 1);
    f.add(`${ORIGIN}/b`, 1);
    expect(f.next(0)).not.toBeNull();
    expect(f.next(0)).toBeNull(); // budget held by the in-flight page
    f.recordFailed();
    expect(f.next(0)).not.toBeNull(); // slot returned
  });

  it("marks redirect destinations visited so they are not re-enqueued", () => {
    const f = frontier({ explorers: 1 });
    f.add(`${ORIGIN}/a`, 1);
    f.next(0);
    f.recordMapped(`${ORIGIN}/a-final`);
    expect(f.add(`${ORIGIN}/a-final`, 2)).toBe(false);
    expect(f.mappedCount).toBe(1);
  });
});

describe("dedupeRichestByCanonical", () => {
  it("keeps one snapshot per canonical path — the richest", () => {
    const thin = snapshot({
      url: `${ORIGIN}/orders/1`,
      finalUrl: `${ORIGIN}/orders/1`,
      links: [{ text: "a", href: "/a" }],
    });
    const rich = snapshot({
      url: `${ORIGIN}/orders/2`,
      finalUrl: `${ORIGIN}/orders/2`,
      links: [
        { text: "a", href: "/a" },
        { text: "b", href: "/b" },
      ],
      forms: [{ name: null, action: null, method: "post", inputs: [] }],
    });
    const home = snapshot();
    const out = dedupeRichestByCanonical([thin, rich, home], ORIGIN);
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.url.includes("/orders"))).toBe(rich);
  });
});
