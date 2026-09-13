// Probe 2 — the two questions that decide whether Lastest can use this engine:
//   (a) visual layer: is there a window-scoped screenshot? (/session/:id/screenshot
//       is SCREEN-scoped — it captures the whole display, desktop included, so it
//       is unusable as a regression baseline.)
//   (b) recording/dom layers: does the AXUI tree expose stable selectors, or only
//       coordinates? Browser recording derives a CSS selector from the DOM; the
//       native equivalent must come from identifier/label/title.
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:4723";
const BUNDLE = process.env.AUT_BUNDLE_ID || "net.whatsapp.WhatsApp";
const OUT = new URL("../proof/", import.meta.url).pathname;
const EL = "element-6066-11e4-a52e-4f735466cecf";

async function wd(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: r.status, json };
}

const created = await wd("POST", "/session", {
  capabilities: {
    alwaysMatch: {
      platformName: "mac",
      "appium:automationName": "mac2",
      "appium:bundleId": BUNDLE,
      "appium:systemPort": Number(process.env.SYSTEM_PORT || 10144),
      "appium:serverStartupTimeout": 180000,
    },
    firstMatch: [{}],
  },
});
if (created.status !== 200) {
  console.log("❌ session failed:", JSON.stringify(created.json).slice(0, 800));
  process.exit(1);
}
const sid = created.json.value.sessionId;
console.log("✅ session →", BUNDLE);

try {
  // ---- (a) window-scoped capture -------------------------------------------
  console.log("\n=== window-scoped screenshot ===");
  const win = await wd("POST", `/session/${sid}/element`, {
    using: "class chain",
    value: "**/XCUIElementTypeWindow",
  });
  if (win.status !== 200) {
    console.log("❌ no window:", JSON.stringify(win.json).slice(0, 300));
  } else {
    const wid = win.json.value[EL];
    const rect = await wd("GET", `/session/${sid}/element/${wid}/rect`);
    console.log("  window rect:", JSON.stringify(rect.json.value));

    const shot = await wd("GET", `/session/${sid}/element/${wid}/screenshot`);
    if (shot.status === 200 && shot.json.value) {
      const buf = Buffer.from(shot.json.value, "base64");
      writeFileSync(OUT + "02-window.png", buf);
      console.log(
        `  ✅ window screenshot: ${Math.round(buf.length / 1024)} KB → proof/02-window.png`,
      );
    } else {
      console.log("  ❌ unsupported:", JSON.stringify(shot.json).slice(0, 300));
    }
  }

  // ---- (b) selector surface -------------------------------------------------
  const src = await wd("GET", `/session/${sid}/source`);
  const xml = src.json.value || "";

  // Count only the app's own UI, not the 200+ menu-bar items which are AppKit
  // boilerplate and never the target of a recorded step.
  const appOnly = xml.split("<XCUIElementTypeMenuBar")[0];
  const tags = [...appOnly.matchAll(/<(XCUIElementType\w+)([^>]*)>/g)];
  let withId = 0,
    withLabel = 0,
    withTitle = 0,
    bare = 0;
  const idSamples = [],
    textSamples = [];
  for (const [, tag, attrs] of tags) {
    const id = /identifier="([^"]*)"/.exec(attrs)?.[1] || "";
    const label = /label="([^"]*)"/.exec(attrs)?.[1] || "";
    const title = /title="([^"]*)"/.exec(attrs)?.[1] || "";
    if (id) {
      withId++;
      if (idSamples.length < 10) idSamples.push(`${tag}[identifier="${id}"]`);
    } else if (label) {
      withLabel++;
      if (textSamples.length < 10) textSamples.push(`${tag}[label="${label}"]`);
    } else if (title) {
      withTitle++;
      if (textSamples.length < 10) textSamples.push(`${tag}[title="${title}"]`);
    } else bare++;
  }
  console.log(
    `\n=== selector surface (app window only, ${tags.length} elements) ===`,
  );
  console.log(`  identifier (AX id):   ${withId}`);
  console.log(`  label only:           ${withLabel}`);
  console.log(`  title only:           ${withTitle}`);
  console.log(`  NOTHING addressable:  ${bare}   <-- coordinate-only`);
  if (idSamples.length) {
    console.log("\n  identifier samples:");
    idSamples.forEach((s) => console.log("   ", s));
  }
  if (textSamples.length) {
    console.log("\n  label/title samples:");
    textSamples.forEach((s) => console.log("   ", s));
  }

  // Can a human-authored selector resolve the one real control on this screen?
  console.log("\n=== resolving the 'Continue' button ===");
  for (const [name, using, value] of [
    ["by label", "-ios predicate string", "label CONTAINS 'Continue'"],
    [
      "by type+label",
      "-ios predicate string",
      "elementType == 9 AND label CONTAINS 'Continue'",
    ],
    [
      "class chain",
      "class chain",
      "**/XCUIElementTypeButton[`label CONTAINS 'Continue'`]",
    ],
  ]) {
    const f = await wd("POST", `/session/${sid}/element`, { using, value });
    const ok = f.status === 200 && f.json.value?.[EL];
    console.log(
      `  ${name.padEnd(16)} → ${ok ? "✅ resolved" : "❌ " + (f.json.value?.error || f.status)}`,
    );
  }
} finally {
  await wd("DELETE", `/session/${sid}`);
  console.log("\nsession deleted");
}
