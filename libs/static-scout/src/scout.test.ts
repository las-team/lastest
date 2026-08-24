import { describe, it, expect, vi, afterEach } from "vitest";

import { scoutUrlStatic } from "./scout";

/** Stub `fetch` with a real `Response` so the streaming-reader path in
 *  `scoutUrlStatic` runs exactly as it does in production. */
function stubHtml(html: string, init?: { status?: number; url?: string }) {
  const res = new Response(html, {
    status: init?.status ?? 200,
    headers: { "content-type": "text/html" },
  });
  if (init?.url) Object.defineProperty(res, "url", { value: init.url });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => res),
  );
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAGE = `<!doctype html>
<html>
  <head>
    <title>  Featurely &mdash; Roadmaps  </title>
    <meta name="description" content="Roadmaps &amp; feedback for product teams">
  </head>
  <body>
    <h1>Ship the <em>right</em> features</h1>
    <h2>Pricing</h2>
    <h2>Pricing</h2>
    <h4>Not collected</h4>
    <nav>
      <a href="/features">Features</a>
      <a href='/pricing'>Pricing</a>
      <a href="javascript:void(0)">Menu</a>
      <a>No href</a>
    </nav>
    <form method="POST" action="/api/auth/sign-in">
      <input type="email" name="email" id="email-field" placeholder="you@example.com">
      <input type="password" name="password" aria-label="Password">
      <textarea name="notes"></textarea>
      <button data-testid="submit-btn">Sign in</button>
    </form>
    <input type="submit" value="Subscribe">
    <div id="root" data-testid="app-shell"></div>
  </body>
</html>`;

describe("scoutUrlStatic — extraction", () => {
  it("extracts title, description and h1-h3 headings only, deduped", async () => {
    stubHtml(PAGE);

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.title).toBe("Featurely &mdash; Roadmaps");
    expect(r.description).toBe("Roadmaps & feedback for product teams");
    // Inner tags stripped, entities decoded, h4 ignored, duplicate h2 collapsed.
    expect(r.headings).toEqual(["Ship the right features", "Pricing"]);
  });

  it("extracts forms with method, action and typed inputs", async () => {
    stubHtml(PAGE);

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.forms).toHaveLength(1);
    const form = r.forms[0];
    expect(form.method).toBe("post");
    expect(form.action).toBe("/api/auth/sign-in");
    expect(form.inputs).toEqual([
      {
        tag: "input",
        type: "email",
        name: "email",
        id: "email-field",
        placeholder: "you@example.com",
        label: null,
      },
      {
        tag: "input",
        type: "password",
        name: "password",
        id: null,
        placeholder: null,
        label: "Password",
      },
      {
        tag: "textarea",
        type: null,
        name: "notes",
        id: null,
        placeholder: null,
        label: null,
      },
    ]);
  });

  it("collects <button> text and submit-input values as buttons", async () => {
    stubHtml(PAGE);

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.buttons).toEqual(["Sign in", "Subscribe"]);
  });

  it("keeps single- and double-quoted hrefs and drops javascript:/href-less links", async () => {
    stubHtml(PAGE);

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.links).toEqual([
      { text: "Features", href: "/features" },
      { text: "Pricing", href: "/pricing" },
    ]);
  });

  it("builds candidate selectors from testids, ids and button names", async () => {
    stubHtml(PAGE);

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.testIds).toEqual(["submit-btn", "app-shell"]);
    expect(r.candidateSelectors).toContain("getByTestId('submit-btn')");
    expect(r.candidateSelectors).toContain("#email-field");
    expect(r.candidateSelectors).toContain("#root");
    expect(r.candidateSelectors).toContain(
      "getByRole('button', { name: /Sign in/i })",
    );
  });

  it("escapes regex metacharacters in button-derived selectors", async () => {
    stubHtml("<html><body><button>Save (draft)</button></body></html>");

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.candidateSelectors).toContain(
      "getByRole('button', { name: /Save \\(draft\\)/i })",
    );
  });

  it("reports the redirected finalUrl alongside the requested url", async () => {
    stubHtml(PAGE, { url: "https://www.example.com/home" });

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.url).toBe("https://example.com/");
    expect(r.finalUrl).toBe("https://www.example.com/home");
  });

  it("carries the no-JS caveat in the note", async () => {
    stubHtml(PAGE);

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.note).toMatch(/Static HTML only/);
  });
});

describe("scoutUrlStatic — degenerate input", () => {
  it("returns empty collections and null metadata for an empty document", async () => {
    stubHtml("");

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.title).toBeNull();
    expect(r.description).toBeNull();
    expect(r.headings).toEqual([]);
    expect(r.forms).toEqual([]);
    expect(r.buttons).toEqual([]);
    expect(r.links).toEqual([]);
    expect(r.testIds).toEqual([]);
    expect(r.candidateSelectors).toEqual([]);
  });

  it("throws on a non-2xx target response", async () => {
    stubHtml("<html></html>", { status: 503 });

    await expect(scoutUrlStatic("https://example.com/")).rejects.toThrow(
      "Target returned HTTP 503",
    );
  });
});

describe("scoutUrlStatic — bounds", () => {
  it("stops pulling chunks once the byte cap is passed", async () => {
    // The cap is enforced at chunk boundaries: the reader stops requesting
    // more once the running total passes MAX_BYTES, so whatever arrived in
    // the chunk that crossed it is still parsed. Three 400KB chunks — the
    // third must never be read.
    const chunk = (marker: string) =>
      new TextEncoder().encode(
        `<h1>${marker}</h1>` + "<p>x</p>".repeat(50_000),
      );
    const chunks = [chunk("first"), chunk("second"), chunk("third")];
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled < chunks.length) controller.enqueue(chunks[pulled++]);
        else controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );

    const r = await scoutUrlStatic("https://example.com/");

    // Parsing saw only the first two chunks. (`pulled` is not asserted: a
    // ReadableStream pulls one chunk ahead of what the reader consumed.)
    expect(r.headings).toEqual(["first", "second"]);
    expect(pulled).toBeLessThanOrEqual(chunks.length);
  });

  it("caps headings, links and testids at their documented limits", async () => {
    const many =
      Array.from({ length: 80 }, (_, i) => `<h1>H${i}</h1>`).join("") +
      Array.from({ length: 80 }, (_, i) => `<a href="/l${i}">L${i}</a>`).join(
        "",
      ) +
      Array.from(
        { length: 80 },
        (_, i) => `<div data-testid="t${i}"></div>`,
      ).join("");
    stubHtml(`<html><body>${many}</body></html>`);

    const r = await scoutUrlStatic("https://example.com/");

    expect(r.headings).toHaveLength(30);
    expect(r.links).toHaveLength(60);
    expect(r.testIds).toHaveLength(40);
    expect(r.candidateSelectors.length).toBeLessThanOrEqual(50);
  });
});
