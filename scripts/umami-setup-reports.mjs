#!/usr/bin/env node
/**
 * Provisions Umami v2 Goals / Funnel / Journey / Retention reports.
 *
 * Idempotent: re-running skips reports that already exist (matched by name).
 *
 * Usage:
 *   UMAMI_URL=http://192.168.1.138:3300 \
 *   UMAMI_USER=admin \
 *   UMAMI_PASS=<password> \
 *   UMAMI_WEBSITE_ID=71913ad7-570d-4b5c-843e-3bd7bab33e5f \
 *     node scripts/umami-setup-reports.mjs
 *
 * Or with an API token instead of user/pass:
 *   UMAMI_TOKEN=<bearer-token> ... node scripts/umami-setup-reports.mjs
 */

const URL_BASE = (process.env.UMAMI_URL || 'http://192.168.1.138:3300').replace(/\/$/, '');
const WEBSITE_ID = process.env.UMAMI_WEBSITE_ID;
const USER = process.env.UMAMI_USER;
const PASS = process.env.UMAMI_PASS;
let TOKEN = process.env.UMAMI_TOKEN || null;

if (!WEBSITE_ID) die('UMAMI_WEBSITE_ID is required');
if (!TOKEN && !(USER && PASS)) die('Provide UMAMI_TOKEN or both UMAMI_USER + UMAMI_PASS');

// Reports cover the last 90 days by default. Umami stores the dates on the
// report config; the UI lets the user widen them per view, so this is just a
// sane default that includes recent data once events start flowing.
const END = new Date();
const START = new Date(Date.now() - 90 * 24 * 3600 * 1000);

const fmt = (d) => d.toISOString();

const GOALS = [
  { name: 'Signup completed',            type: 'event', value: 'signup_completed' },
  { name: 'Repo linked',                 type: 'event', value: 'repo_linked' },
  { name: 'First test created or recorded (recorder)', type: 'event', value: 'test_recorded' },
  { name: 'First test created (AI)',     type: 'event', value: 'test_created' },
  { name: 'Test run started',            type: 'event', value: 'test_run_started' },
  { name: 'Test run completed',          type: 'event', value: 'test_run_completed' },
  { name: 'Diff approved',               type: 'event', value: 'diff_approved' },
  { name: 'Schedule created',            type: 'event', value: 'schedule_created' },
];

const FUNNEL = {
  name: 'Activation funnel — signup → first run completed',
  description: 'Day-1 activation: how many users get from signup to a successful test run completion.',
  parameters: {
    startDate: fmt(START),
    endDate: fmt(END),
    window: 1440, // minutes — 24h to complete the funnel
    steps: [
      { type: 'event', value: 'signup_completed' },
      { type: 'event', value: 'repo_linked' },
      { type: 'event', value: 'test_recorded' },     // OR test_created — picking recorder as the canonical first-test path
      { type: 'event', value: 'test_run_started' },
      { type: 'event', value: 'test_run_completed' },
    ],
  },
};

const JOURNEY = {
  name: 'Journey — signup to first diff approval',
  description: 'Free-form path users take from signup_completed to diff_approved (5 intermediate nodes).',
  parameters: {
    startDate: fmt(START),
    endDate: fmt(END),
    steps: 5,
    startStep: 'signup_completed',
    endStep: 'diff_approved',
  },
};

const RETENTION = {
  name: 'Daily retention — last 90 days',
  description: 'Daily cohorts grouped by first visit; columns show return rate by day.',
  parameters: {
    startDate: fmt(START),
    endDate: fmt(END),
  },
};

async function main() {
  if (!TOKEN) {
    log('Logging in...');
    const r = await fetch(`${URL_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    if (!r.ok) die(`Login failed: ${r.status} ${await r.text()}`);
    const { token } = await r.json();
    TOKEN = token;
    log('  token acquired');
  }

  const existing = await getExistingReports();
  log(`Existing reports for website: ${existing.size === 0 ? '(none)' : Array.from(existing).join(', ')}`);

  for (const g of GOALS) {
    const name = `Goal: ${g.name}`;
    if (existing.has(name)) { log(`  skip goal "${g.name}" (exists)`); continue; }
    await createReport({
      websiteId: WEBSITE_ID,
      type: 'goal',
      name,
      description: `Conversion target on event "${g.value}".`,
      parameters: { startDate: fmt(START), endDate: fmt(END), type: g.type, value: g.value },
    });
    log(`  + goal "${g.name}"`);
  }

  await createIfMissing(existing, { websiteId: WEBSITE_ID, type: 'funnel',    ...FUNNEL });
  await createIfMissing(existing, { websiteId: WEBSITE_ID, type: 'journey',   ...JOURNEY });
  await createIfMissing(existing, { websiteId: WEBSITE_ID, type: 'retention', ...RETENTION });

  log('\nDone. Open Umami → Reports tab to view.');
}

async function getExistingReports() {
  const r = await fetch(`${URL_BASE}/api/reports?websiteId=${WEBSITE_ID}&pageSize=200`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) die(`List reports failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  const rows = Array.isArray(data) ? data : (data.data || data.rows || []);
  return new Set(rows.map((row) => row.name));
}

async function createReport(body) {
  const r = await fetch(`${URL_BASE}/api/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) die(`Create report "${body.name}" failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function createIfMissing(existing, body) {
  if (existing.has(body.name)) { log(`  skip ${body.type} "${body.name}" (exists)`); return; }
  await createReport(body);
  log(`  + ${body.type} "${body.name}"`);
}

function log(...a) { console.log(...a); }
function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

main().catch((e) => die(e.stack || String(e)));
