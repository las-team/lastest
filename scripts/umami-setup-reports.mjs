#!/usr/bin/env node
/**
 * Provisions / refreshes Umami v2 Goals / Funnels / Journey / Retention reports.
 *
 * Idempotent. On re-run, existing reports (matched by name) are UPDATED so the
 * date window stays current — saved reports otherwise freeze startDate/endDate
 * at creation time and silently drop new events.
 *
 * Window strategy:
 *   startDate = now - 90 days  (rolling)
 *   endDate   = now + 365 days (far future, so reports keep catching events)
 *
 * Usage:
 *   UMAMI_URL=http://192.168.1.138:3300 \
 *   UMAMI_USER=admin UMAMI_PASS=umami \
 *   UMAMI_WEBSITE_IDS=e00b8a02-...,71913ad7-... \
 *     node scripts/umami-setup-reports.mjs
 *
 * Defaults: UMAMI_URL=http://192.168.1.138:3300, USER=admin, PASS=umami,
 * WEBSITE_IDS = prod (app.lastest.cloud) + local (localhost:3000).
 *
 * Token auth still supported: UMAMI_TOKEN=<bearer> ... node scripts/...
 */

const URL_BASE = (process.env.UMAMI_URL || 'http://192.168.1.138:3300').replace(/\/$/, '');
const USER = process.env.UMAMI_USER || 'admin';
const PASS = process.env.UMAMI_PASS || 'umami';
let TOKEN = process.env.UMAMI_TOKEN || null;

const DEFAULT_WEBSITE_IDS = [
  'e00b8a02-34a2-49bd-b759-0c7fceb40f8c', // Lastest (app.lastest.cloud)
  '71913ad7-570d-4b5c-843e-3bd7bab33e5f', // Lastest-local (localhost:3000)
];

const WEBSITE_IDS = (process.env.UMAMI_WEBSITE_IDS || process.env.UMAMI_WEBSITE_ID || DEFAULT_WEBSITE_IDS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!TOKEN && !(USER && PASS)) die('Provide UMAMI_TOKEN or both UMAMI_USER + UMAMI_PASS');
if (WEBSITE_IDS.length === 0) die('No website IDs configured');

const NOW = new Date();
const START = new Date(NOW.getTime() - 90 * 24 * 3600 * 1000);
const END = new Date(NOW.getTime() + 365 * 24 * 3600 * 1000);
const fmt = (d) => d.toISOString();

// Mirrors src/lib/analytics/events.ts. Keep in sync.
const GOALS = [
  { name: 'Signup completed',                          value: 'signup_completed' },
  { name: 'Repo linked',                               value: 'repo_linked' },
  { name: 'Area created',                              value: 'area_created' },
  { name: 'Route added',                               value: 'route_added' },
  { name: 'Setup script saved',                        value: 'setup_script_saved' },
  { name: 'Storage state saved',                       value: 'storage_state_saved' },
  { name: 'First test recorded (recorder)',            value: 'test_recorded' },
  { name: 'First test created (AI)',                   value: 'test_created' },
  { name: 'Test run started',                          value: 'test_run_started' },
  { name: 'Test run completed',                        value: 'test_run_completed' },
  { name: 'Baseline approved',                         value: 'baseline_approved' },
  { name: 'Baseline rejected',                         value: 'baseline_rejected' },
  { name: 'Diff approved',                             value: 'diff_approved' },
  { name: 'Diff rejected',                             value: 'diff_rejected' },
  { name: 'Schedule created',                          value: 'schedule_created' },
  { name: 'PR linked',                                 value: 'pr_linked' },
  { name: 'Runner connected',                          value: 'runner_connected' },
];

const FUNNELS = [
  {
    name: 'Activation funnel (recorder) — signup → first run completed',
    description: 'Day-1 activation via the recorder path: signup → repo → test_recorded → run started → run completed.',
    steps: [
      { type: 'event', value: 'signup_completed' },
      { type: 'event', value: 'repo_linked' },
      { type: 'event', value: 'test_recorded' },
      { type: 'event', value: 'test_run_started' },
      { type: 'event', value: 'test_run_completed' },
    ],
  },
  {
    name: 'Activation funnel (AI) — signup → first run completed',
    description: 'Day-1 activation via the AI-create-test path: signup → repo → test_created → run started → run completed.',
    steps: [
      { type: 'event', value: 'signup_completed' },
      { type: 'event', value: 'repo_linked' },
      { type: 'event', value: 'test_created' },
      { type: 'event', value: 'test_run_started' },
      { type: 'event', value: 'test_run_completed' },
    ],
  },
  {
    name: 'Activation funnel (short) — signup → first run started',
    description: 'Compact 3-step funnel for early activation, useful at low traffic where 5-step funnels rarely complete.',
    steps: [
      { type: 'event', value: 'signup_completed' },
      { type: 'event', value: 'repo_linked' },
      { type: 'event', value: 'test_run_started' },
    ],
  },
];

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
  name: 'Daily retention — rolling 90 days',
  description: 'Daily cohorts grouped by first visit; columns show return rate by day.',
  parameters: {
    startDate: fmt(START),
    endDate: fmt(END),
  },
};

async function main() {
  if (!TOKEN) {
    log('Logging in as', USER, '@', URL_BASE);
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

  for (const websiteId of WEBSITE_IDS) {
    log(`\n=== Website ${websiteId} ===`);
    const existing = await getExistingReports(websiteId);
    log(`Existing: ${existing.size === 0 ? '(none)' : `${existing.size} reports`}`);

    for (const g of GOALS) {
      const name = `Goal: ${g.name}`;
      await upsert(existing, name, {
        websiteId,
        type: 'goal',
        name,
        description: `Conversion target on event "${g.value}".`,
        parameters: { startDate: fmt(START), endDate: fmt(END), type: 'event', value: g.value },
      });
    }

    for (const f of FUNNELS) {
      await upsert(existing, f.name, {
        websiteId,
        type: 'funnel',
        name: f.name,
        description: f.description,
        parameters: { startDate: fmt(START), endDate: fmt(END), window: 1440, steps: f.steps },
      });
    }

    await upsert(existing, JOURNEY.name, { websiteId, type: 'journey', ...JOURNEY });
    await upsert(existing, RETENTION.name, { websiteId, type: 'retention', ...RETENTION });
  }

  log('\nDone. Open Umami → Reports tab to view.');
}

async function getExistingReports(websiteId) {
  const r = await fetch(`${URL_BASE}/api/reports?websiteId=${websiteId}&pageSize=200`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) die(`List reports failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  const rows = Array.isArray(data) ? data : (data.data || data.rows || []);
  return new Map(rows.map((row) => [row.name, row.id]));
}

async function upsert(existing, name, body) {
  const existingId = existing.get(name);
  if (existingId) {
    const r = await fetch(`${URL_BASE}/api/reports/${existingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) die(`Update "${name}" failed: ${r.status} ${await r.text()}`);
    log(`  ~ update ${body.type}  "${name}"`);
    return;
  }
  const r = await fetch(`${URL_BASE}/api/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) die(`Create "${name}" failed: ${r.status} ${await r.text()}`);
  const created = await r.json();
  if (created?.id) existing.set(name, created.id);
  log(`  + create ${body.type}  "${name}"`);
}

function log(...a) { console.log(...a); }
function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

main().catch((e) => die(e.stack || String(e)));
