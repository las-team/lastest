// Probe 1 — can mac2driver attach to WhatsApp at all, and what does it expose?
// Raw W3C over fetch (no webdriverio) so the wire traffic is legible in findings.
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:4723";
const BUNDLE = process.env.AUT_BUNDLE_ID || "net.whatsapp.WhatsApp";
const OUT = new URL("../proof/", import.meta.url).pathname;

export async function wd(method, path, body) {
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
  console.log("❌ session failed:", JSON.stringify(created.json).slice(0, 900));
  process.exit(1);
}
const sid = created.json.value.sessionId;
console.log("✅ session:", sid, "→", BUNDLE);

try {
  // Full-screen screenshot. Screen-scoped, not app-scoped — see probe 02.
  const shot = await wd("GET", `/session/${sid}/screenshot`);
  const b64 = shot.json.value || "";
  console.log(
    `✅ screen screenshot: ~${Math.round((b64.length * 0.75) / 1024)} KB`,
  );
  if (b64) writeFileSync(OUT + "01-screen.png", Buffer.from(b64, "base64"));

  // The AXUI hierarchy — the "DOM equivalent" Lastest's dom/text layers would read.
  const src = await wd("GET", `/session/${sid}/source`);
  const xml = src.json.value || "";
  console.log(`✅ AXUI source: ${xml.length} chars`);
  writeFileSync(OUT + "01-source.xml", xml);

  const tags = [...xml.matchAll(/<(XCUIElementType\w+)/g)].map((m) => m[1]);
  const counts = {};
  for (const t of tags) counts[t] = (counts[t] || 0) + 1;
  console.log(`   ${tags.length} elements, top types:`);
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([t, n]) => console.log(`     ${String(n).padStart(4)}  ${t}`));
} finally {
  await wd("DELETE", `/session/${sid}`);
  console.log("session deleted");
}
