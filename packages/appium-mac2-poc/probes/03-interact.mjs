// Probe 3 — the full loop Lastest would run per step:
//   resolve selector → act → re-capture window → assert new state.
// Stops at the linking screen; the PoC never authenticates.
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
  console.log("❌ session failed:", JSON.stringify(created.json).slice(0, 600));
  process.exit(1);
}
const sid = created.json.value.sessionId;
console.log("✅ session →", BUNDLE);

const find = async (value, using = "-ios predicate string") =>
  wd("POST", `/session/${sid}/element`, { using, value });

const windowShot = async (name) => {
  const w = await find("**/XCUIElementTypeWindow", "class chain");
  if (w.status !== 200) return console.log(`  ⚠ no window for ${name}`);
  const s = await wd(
    "GET",
    `/session/${sid}/element/${w.json.value[EL]}/screenshot`,
  );
  if (s.status === 200 && s.json.value) {
    const buf = Buffer.from(s.json.value, "base64");
    writeFileSync(OUT + name, buf);
    console.log(`  📸 ${name} (${Math.round(buf.length / 1024)} KB)`);
  }
};

// AX labels can carry invisible formatting characters; normalise before comparing.
const labelsOnScreen = async () => {
  const src = await wd("GET", `/session/${sid}/source`);
  const app = (src.json.value || "").split("<XCUIElementTypeMenuBar")[0];
  return [...app.matchAll(/label="([^"]+)"/g)]
    .map((m) => m[1].replace(/‎/g, "").trim())
    .filter(Boolean);
};

try {
  console.log("\n=== step 1: welcome screen ===");
  const before = await labelsOnScreen();
  console.log("  labels:", JSON.stringify(before.slice(0, 6)));
  await windowShot("03a-welcome.png");

  console.log("\n=== step 2: click Continue ===");
  const btn = await find("elementType == 9 AND label ENDSWITH 'Continue'");
  if (btn.status !== 200) {
    console.log("  ❌ could not resolve Continue");
    process.exit(1);
  }
  const click = await wd(
    "POST",
    `/session/${sid}/element/${btn.json.value[EL]}/click`,
  );
  console.log(
    `  click → ${click.status === 200 ? "✅ dispatched" : "❌ " + JSON.stringify(click.json).slice(0, 200)}`,
  );

  await new Promise((r) => setTimeout(r, 3000));

  console.log("\n=== step 3: assert transition ===");
  const after = await labelsOnScreen();
  console.log("  labels:", JSON.stringify(after.slice(0, 8)));

  // A macOS modal OVERLAYS the view tree rather than replacing it (unlike a
  // browser navigation swapping the DOM), so "old text disappeared" is the wrong
  // assertion here — the welcome screen legitimately stays behind the sheet.
  // Assert on what the dialog ADDED instead.
  const appeared = after.filter((l) => !before.includes(l));
  console.log("  new labels:", JSON.stringify(appeared));

  const dialogOpened = appeared.includes("Close");
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  console.log(`\n  dialog opened  : ${dialogOpened ? "✅" : "❌"}`);
  console.log(`  screen changed : ${changed ? "✅" : "❌"}`);
  console.log(
    `\n  RESULT: ${dialogOpened && changed ? "✅ PASS — click drove a real UI transition" : "❌ FAIL"}`,
  );

  // NOTE: deliberately no screenshot here. The login sheet renders a LIVE QR
  // code that links a real device to a WhatsApp account — it is a credential
  // and must never land in a committed proof artifact. The welcome-screen
  // capture (03a) is the visual evidence; this step is asserted via the AX tree.
} finally {
  await wd("DELETE", `/session/${sid}`);
  console.log("\nsession deleted");
}
