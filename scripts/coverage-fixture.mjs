/**
 * Generate a prod-shaped Veeva call-report extract + an INDEPENDENT oracle.
 *
 * The oracle is computed here with plain Map counting — it never imports any
 * coverage code, so it is a genuine external check on what the model reports.
 *
 * Deliberate properties of the data:
 *  - heavy skew (DE/Detail huge, PT/Sample Drop = 3 rows)
 *  - genuinely absent combinations (DE never has a Remote call)
 *  - three columns that MUST be rejected as dimensions:
 *      call_id__v  -> identifier (distinct/rows > 0.5)
 *      notes__v    -> free text (> 50 distinct)
 *      status__v   -> no variation (1 distinct)
 */
import fs from "fs";
import path from "path";

const OUT = process.argv[2] || ".";

const COUNTRIES = [
  "DE",
  "FR",
  "ES",
  "IT",
  "US",
  "GB",
  "JP",
  "BR",
  "PT",
  "PL",
  "NL",
  "SE",
];
const CALL_TYPES = [
  "Detail",
  "Sample Drop",
  "Remote",
  "Group",
  "Event",
  "Lunch",
  "Phone",
  "Email",
];
const CHANNELS = ["Face to Face", "Remote", "Phone"];
const ACCOUNT_TYPES = ["HCP", "Hospital", "Pharmacy"];

// Deterministic PRNG so the fixture and every assertion are reproducible.
let seed = 20260802;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}

/**
 * Volume plan: explicit (country, callType) -> row count.
 * Everything not listed here simply does not occur.
 */
const PLAN = [
  ["DE", "Detail", 1800],
  ["DE", "Sample Drop", 240],
  ["DE", "Group", 60],
  ["DE", "Email", 30],
  // DE / Remote deliberately absent -- the "0 rows" case
  ["FR", "Detail", 900],
  ["FR", "Remote", 120],
  ["FR", "Sample Drop", 80],
  ["ES", "Detail", 400],
  ["ES", "Lunch", 45],
  ["IT", "Detail", 380],
  ["IT", "Event", 25],
  ["US", "Detail", 700],
  ["US", "Remote", 260],
  ["US", "Phone", 90],
  ["GB", "Detail", 300],
  ["GB", "Remote", 55],
  ["JP", "Detail", 210],
  ["JP", "Group", 20],
  ["BR", "Detail", 160],
  ["PT", "Detail", 40],
  ["PT", "Sample Drop", 3], // the long-tail case
  ["PL", "Detail", 120],
  ["NL", "Detail", 95],
  ["NL", "Remote", 15],
  ["SE", "Detail", 70],
  ["SE", "Email", 12],
];

const NOTES = Array.from(
  { length: 120 },
  (_, i) => `Discussed indication ${i} and follow-up schedule`,
);

function buildRows() {
  const rows = [];
  let id = 0;
  for (const [country, callType, n] of PLAN) {
    for (let i = 0; i < n; i++) {
      id++;
      rows.push({
        call_id__v: `CALL-${String(id).padStart(6, "0")}`,
        country__v: country,
        call_type__v: callType,
        channel__v:
          callType === "Remote"
            ? "Remote"
            : callType === "Phone"
              ? "Phone"
              : pick(CHANNELS),
        account_type__v: pick(ACCOUNT_TYPES),
        status__v: "Submitted",
        notes__v: pick(NOTES),
      });
    }
  }
  // Shuffle so truncation at 1000 rows does not simply take the first plan
  // entries -- this is what makes the row-cap defect observable.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}

const HEADERS = [
  "call_id__v",
  "country__v",
  "call_type__v",
  "channel__v",
  "account_type__v",
  "status__v",
  "notes__v",
];

function toCsv(rows) {
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    HEADERS.join(","),
    ...rows.map((r) => HEADERS.map((h) => esc(r[h])).join(",")),
  ].join("\n");
}

// ---- ORACLE (independent of all coverage code) ----------------------------

// Field-sorted, matching the model's canonical coordsKey encoding.
const DIM_FIELDS = [
  "account_type__v",
  "call_type__v",
  "channel__v",
  "country__v",
].sort();

function oracle(rows) {
  const dimensions = {};
  for (const f of HEADERS) {
    const counts = new Map();
    for (const r of rows) counts.set(r[f], (counts.get(r[f]) || 0) + 1);
    dimensions[f] = {
      cardinality: counts.size,
      distinctRatio: counts.size / rows.length,
      values: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, recordCount]) => ({
          value,
          recordCount,
          share: recordCount / rows.length,
        })),
    };
  }

  // Occurring cells over the four real dimensions.
  const cells = new Map();
  for (const r of rows) {
    const key = DIM_FIELDS.map((f) => `${f}=${r[f]}`).join("|");
    cells.set(key, (cells.get(key) || 0) + 1);
  }

  const cartesian = DIM_FIELDS.reduce(
    (acc, f) => acc * dimensions[f].cardinality,
    1,
  );

  // Two-field (country x call_type) view -- the pharma question:
  // "which call types are recorded, per country?"
  const pairs = new Map();
  for (const r of rows) {
    const k = `${r.country__v}|${r.call_type__v}`;
    pairs.set(k, (pairs.get(k) || 0) + 1);
  }

  return {
    rowCount: rows.length,
    dimensions,
    cellCount: cells.size,
    cells: [...cells.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([coordsKey, observedCount]) => ({ coordsKey, observedCount })),
    cartesian,
    skippedAsNonOccurring: cartesian - cells.size,
    countryCallTypePairs: [...pairs.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => ({ pair: k, records: n })),
  };
}

const all = buildRows();
const small = all.slice(0, 800); // under the 1000-row cache cap
const big = all; // well over it

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "calls-small.csv"), toCsv(small));
fs.writeFileSync(path.join(OUT, "calls-big.csv"), toCsv(big));

const bundle = {
  small: oracle(small),
  big: oracle(big),
  // What the pipeline will ACTUALLY see for the big file, given the 1000-row
  // cache cap in src/server/actions/csv-sources.ts.
  bigFirst1000: oracle(big.slice(0, 1000)),
};
fs.writeFileSync(
  path.join(OUT, "oracle.json"),
  JSON.stringify(bundle, null, 2),
);

console.log(`small: ${small.length} rows, ${bundle.small.cellCount} cells`);
console.log(
  `big:   ${big.length} rows, ${bundle.big.cellCount} cells, cartesian ${bundle.big.cartesian}`,
);
console.log(
  `big first 1000: ${bundle.bigFirst1000.cellCount} cells, ` +
    `${bundle.bigFirst1000.dimensions.country__v.cardinality} countries, ` +
    `${bundle.bigFirst1000.dimensions.call_type__v.cardinality} call types`,
);
console.log(`written to ${path.resolve(OUT)}`);
