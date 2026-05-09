/* eslint-disable no-console */
/**
 * Export an anonymized public dataset of UI flake patterns.
 *
 * Sources are pluggable:
 *   - local  → DATABASE_URL (defaults to host postgres)
 *   - olares → OLARES_DATABASE_URL (user must port-forward prod postgres themselves)
 *
 * Always read-only. Identifiers are HMAC-SHA256 hashed with DATASET_SALT.
 * URLs / repo names / git refs / screenshot paths / raw error contents
 * never leave the DB — error messages are scrubbed via regex pipeline.
 *
 *   DATASET_SALT=$(openssl rand -hex 32) \
 *     pnpm tsx scripts/export-flake-dataset.ts \
 *       --sources local,olares --out data/open-dataset/
 */

import postgres from 'postgres';
import { createHmac } from 'node:crypto';
import { mkdirSync, createWriteStream, writeFileSync, type WriteStream } from 'node:fs';
import { resolve, join } from 'node:path';

// ─── CLI ──────────────────────────────────────────────────────────────

interface Args {
  out: string;
  sources: SourceName[];
  minRunsPerTeam: number;
}

type SourceName = 'local' | 'olares';

function parseArgs(argv: string[]): Args {
  const out: Args = { out: 'data/open-dataset/', sources: ['local', 'olares'], minRunsPerTeam: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') out.out = next();
    else if (a === '--sources') out.sources = next().split(',').map((s) => s.trim()) as SourceName[];
    else if (a === '--min-runs-per-team') out.minRunsPerTeam = parseInt(next(), 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: tsx scripts/export-flake-dataset.ts [--out DIR] [--sources local,olares] [--min-runs-per-team N]');
      process.exit(0);
    }
  }
  for (const s of out.sources) {
    if (s !== 'local' && s !== 'olares') {
      console.error(`Unknown source: ${s} (allowed: local, olares)`);
      process.exit(2);
    }
  }
  return out;
}

// ─── Redaction ────────────────────────────────────────────────────────

const SALT = process.env.DATASET_SALT;
if (!SALT) {
  console.error('DATASET_SALT env var is required (use a fresh random hex per export).');
  process.exit(2);
}

function hashId(value: string | null | undefined, kind: string): string | null {
  if (!value) return null;
  return createHmac('sha256', SALT!).update(`${kind}:${value}`).digest('hex').slice(0, 16);
}

function bucketDuration(ms: number | null | undefined): string {
  if (ms == null) return 'unknown';
  if (ms < 1000) return '<1s';
  if (ms < 5000) return '1-5s';
  if (ms < 15000) return '5-15s';
  if (ms < 60000) return '15-60s';
  return '>60s';
}

function dateBucket(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// URL/host: no \b before scheme — real-world errors concatenate without whitespace
// (e.g. "Base URLhttp://app.example.com").
const URL_RX = /https?:\/\/[^\s'"<>)]+/gi;
const HOST_RX = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\.(?:com|io|net|org|cloud|app|dev|local|co|ai|sh|to|me|info|xyz|us|uk|eu)\b/gi;
const HOST_SHORT_RX = /\b[a-z0-9][a-z0-9-]*\.(?:com|io|net|org|cloud|app|dev|local|co|ai|sh|to|me|info|xyz)\b/gi;
const LOCALHOST_RX = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{1,5})?\b/gi;
const IPV4_RX = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g;
const IPV6_RX = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi;
const UUID_RX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Permissive email: anything that looks like local@domain, even with truncated TLDs.
const EMAIL_RX = /[a-z0-9._%+-]+@[a-z0-9._-]+/gi;
const QUOTED_RX = /(["'`])[^"'`\n]{2,}\1/g;
const HASH_RX = /\b(?=[a-z0-9-_]{40,})(?=[^\s]*\d)(?=[^\s]*[a-z])[a-z0-9-_]+\b/gi;

function scrubError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw;
  s = s.replace(URL_RX, '<URL>');
  s = s.replace(EMAIL_RX, '<EMAIL>');
  s = s.replace(IPV4_RX, '<IP>');
  s = s.replace(IPV6_RX, '<IP>');
  s = s.replace(LOCALHOST_RX, '<HOST>');
  s = s.replace(UUID_RX, '<UUID>');
  s = s.replace(HOST_RX, '<HOST>');
  s = s.replace(HOST_SHORT_RX, '<HOST>');
  s = s.replace(QUOTED_RX, '<STR>');
  s = s.replace(HASH_RX, '<HASH>');
  s = s.replace(/\s+/g, ' ').trim();

  // Drop signatures that look like they leaked structured content
  // (JSON dumps, page text snapshots, DOM probe outputs). These tend to
  // carry team/repo/user names that no regex can reliably scrub.
  if (s.includes('{') || s.includes('}')) return null;
  // Heuristic: many <STR> placeholders → original was a stringified object.
  const strCount = (s.match(/<STR>/g) ?? []).length;
  if (strCount >= 3) return null;
  // Cap length; further truncation drops trailing leak-prone context.
  if (s.length > 240) s = s.slice(0, 240) + '…';
  return s || null;
}

function categorizeError(scrubbed: string | null): string | null {
  if (!scrubbed) return null;
  const s = scrubbed.toLowerCase();
  if (/timeout|timed out|exceeded.*ms|deadline/.test(s)) return 'timeout';
  if (/locator|selector|element.*not.*(found|visible|attached)|no element matches|waiting for/.test(s))
    return 'selector_not_found';
  if (/expect\(|assertion|to be visible|to have text|to equal/.test(s)) return 'assertion';
  if (/net::|err_|failed to fetch|econnrefused|enotfound|connection refused|network|cors/.test(s))
    return 'network';
  if (/navigation|page\.goto|net::err_aborted/.test(s)) return 'navigation';
  if (/uncaught|referenceerror|typeerror|syntaxerror|cannot read prop/.test(s)) return 'js_error';
  if (/intercept|abort|frame detached/.test(s)) return 'browser_lifecycle';
  return 'other';
}

function classifySelectorKind(t: string | null): string {
  if (!t) return 'other';
  const s = t.toLowerCase();
  if (s.includes('testid') || s === 'data-testid') return 'testid';
  if (s.includes('role') || s.includes('aria')) return 'role';
  if (s === 'text' || s.includes('label') || s.includes('placeholder') || s.includes('alt') || s.includes('title'))
    return 'text';
  if (s.includes('css') || s === 'id' || s === 'name') return 'css';
  if (s.includes('xpath')) return 'xpath';
  if (s.includes('ocr') || s.includes('coords')) return 'visual';
  return 'other';
}

// ─── DB connection ────────────────────────────────────────────────────

function connectionUrlFor(source: SourceName): string {
  if (source === 'local') {
    return process.env.DATABASE_URL || 'postgresql://lastest:lastest@localhost:5432/lastest';
  }
  const url = process.env.OLARES_DATABASE_URL;
  if (!url) {
    console.error(
      'OLARES_DATABASE_URL is not set. Port-forward the prod postgres in another shell, e.g.:\n' +
        '  ssh root@ewyctorlab.olares.local kubectl -n lastest-dev-ewyctorlab port-forward svc/<postgres-svc> 15432:5432\n' +
        'then export OLARES_DATABASE_URL=postgresql://USER:PASS@localhost:15432/DBNAME and re-run.\n' +
        '(--sources local) skips Olares.',
    );
    process.exit(2);
  }
  return url;
}

function makeClient(source: SourceName) {
  // Citus coordinator (Olares) rejects unknown startup params + prepared statements
  // on some queries. Keep the connection minimal; the script is read-only by virtue
  // of running zero INSERT/UPDATE/DELETE statements (grep the source).
  return postgres(connectionUrlFor(source), {
    max: 4,
    prepare: false,
    onnotice: () => {},
  });
}

// ─── Output streams ───────────────────────────────────────────────────

interface Streams {
  flakeRuns: WriteStream;
  visualDiffs: WriteStream;
  selectorFragility: WriteStream;
}

function openStreams(outDir: string): Streams {
  mkdirSync(outDir, { recursive: true });
  return {
    flakeRuns: createWriteStream(join(outDir, 'flake_runs.jsonl')),
    visualDiffs: createWriteStream(join(outDir, 'visual_diffs.jsonl')),
    selectorFragility: createWriteStream(join(outDir, 'selector_fragility.jsonl')),
  };
}

function writeJsonl(stream: WriteStream, record: unknown) {
  stream.write(JSON.stringify(record) + '\n');
}

async function closeStreams(s: Streams): Promise<void> {
  await Promise.all(
    [s.flakeRuns, s.visualDiffs, s.selectorFragility].map(
      (st) => new Promise<void>((res) => st.end(res)),
    ),
  );
}

// ─── Aggregations ─────────────────────────────────────────────────────

interface Counters {
  totalRuns: number;
  totalFlaky: number;
  triageDist: Record<string, number>;
  diffClassDist: Record<string, number>;
  errorCategoryDist: Record<string, number>;
  selectorKindFailures: Record<string, { failures: number; attempts: number }>;
  perSource: Record<string, { runs: number; flaky: number; diffs: number; selectors: number }>;
}

function newCounters(): Counters {
  return {
    totalRuns: 0,
    totalFlaky: 0,
    triageDist: {},
    diffClassDist: {},
    errorCategoryDist: {},
    selectorKindFailures: {},
    perSource: {},
  };
}

function bumpSource(c: Counters, source: SourceName, key: keyof Counters['perSource'][string]) {
  const entry = (c.perSource[source] ??= { runs: 0, flaky: 0, diffs: 0, selectors: 0 });
  entry[key] += 1;
}

// ─── Extraction passes ────────────────────────────────────────────────

async function runSource(
  source: SourceName,
  streams: Streams,
  counters: Counters,
  minRunsPerTeam: number,
): Promise<void> {
  console.log(`[${source}] connecting…`);
  const sql = makeClient(source);

  try {
    // Pre-pass: build per-team run counts; enforce k-anon floor.
    const teamCountsRaw = await sql<Array<{ team_id: string | null; runs: number }>>`
      select r.team_id as team_id, count(tr.id)::int as runs
      from test_results tr
      left join tests t on t.id = tr.test_id
      left join repositories r on r.id = t.repository_id
      group by r.team_id
    `;
    const includedTeams = new Set<string>();
    for (const row of teamCountsRaw) {
      if (row.team_id && row.runs >= minRunsPerTeam) includedTeams.add(row.team_id);
    }
    console.log(
      `[${source}] teams with ≥${minRunsPerTeam} runs: ${includedTeams.size} / ${teamCountsRaw.length}`,
    );
    if (includedTeams.size === 0) {
      console.log(`[${source}] no teams pass k-anonymity floor; skipping.`);
      return;
    }

    // Pre-pass: retry counts. Map original_id → number of retry rows.
    const retryRows = await sql<Array<{ retry_of: string; n: number }>>`
      select retry_of, count(*)::int as n
      from test_results
      where retry_of is not null
      group by retry_of
    `;
    const retryCount = new Map<string, number>();
    for (const r of retryRows) retryCount.set(r.retry_of, r.n);

    // ── Pass 1: flake_runs ─────────────────────────────────────────
    await pass1FlakeRuns(sql, source, streams, counters, includedTeams, retryCount);

    // ── Pass 2: visual_diffs ───────────────────────────────────────
    await pass2VisualDiffs(sql, source, streams, counters, includedTeams);

    // ── Pass 3: selector_fragility ─────────────────────────────────
    await pass3SelectorFragility(sql, source, streams, counters, includedTeams);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function pass1FlakeRuns(
  sql: ReturnType<typeof makeClient>,
  source: SourceName,
  streams: Streams,
  counters: Counters,
  includedTeams: Set<string>,
  retryCount: Map<string, number>,
): Promise<void> {
  const CHUNK = 1000;
  let lastId: string | null = null;
  let total = 0;
  // We never select retry rows (retry_of is not null) — they're aggregated into the original.
  while (true) {
    const rows = await sql<
      Array<{
        id: string;
        test_id: string | null;
        team_id: string | null;
        status: string | null;
        error_message: string | null;
        duration_ms: number | null;
        browser: string | null;
        is_flaky: boolean | null;
        triage: { classification?: string; confidence?: number } | null;
        last_reached_step: number | null;
        total_steps: number | null;
        console_errors: string[] | null;
        soft_errors: string[] | null;
        assertion_results: Array<{ status?: string; passed?: boolean }> | null;
        execution_mode: string | null;
        completed_at: Date | null;
      }>
    >`
      select tr.id,
             tr.test_id,
             r.team_id,
             tr.status,
             tr.error_message,
             tr.duration_ms,
             tr.browser,
             tr.is_flaky,
             tr.triage,
             tr.last_reached_step,
             tr.total_steps,
             tr.console_errors,
             tr.soft_errors,
             tr.assertion_results,
             t.execution_mode,
             trun.completed_at
      from test_results tr
      left join tests t on t.id = tr.test_id
      left join repositories r on r.id = t.repository_id
      left join test_runs trun on trun.id = tr.test_run_id
      where tr.retry_of is null
        ${lastId ? sql`and tr.id > ${lastId}` : sql``}
      order by tr.id
      limit ${CHUNK}
    `;
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      if (!row.team_id || !includedTeams.has(row.team_id)) continue;

      const scrubbed = scrubError(row.error_message);
      const category = categorizeError(scrubbed);
      const triageClass = row.triage?.classification ?? null;
      const triageConfidence =
        typeof row.triage?.confidence === 'number' ? row.triage.confidence : null;

      const lastStep = row.last_reached_step ?? 0;
      const total = row.total_steps ?? 0;

      const assertionFailures = Array.isArray(row.assertion_results)
        ? row.assertion_results.filter(
            (a) => a && (a.status === 'failed' || a.passed === false),
          ).length
        : 0;

      const record = {
        run_id_hash: hashId(row.id, 'run'),
        test_id_hash: hashId(row.test_id ?? null, 'test'),
        team_id_hash: hashId(row.team_id, 'team'),
        status: row.status,
        is_flaky: !!row.is_flaky,
        retry_count: retryCount.get(row.id) ?? 0,
        duration_ms: row.duration_ms,
        duration_bucket: bucketDuration(row.duration_ms),
        total_steps: total,
        last_reached_step: lastStep,
        step_completion_pct: total > 0 ? Math.round((lastStep / total) * 100) : null,
        triage_class: triageClass,
        triage_confidence: triageConfidence,
        error_signature: scrubbed,
        error_category: category,
        console_error_count: Array.isArray(row.console_errors) ? row.console_errors.length : 0,
        soft_error_count: Array.isArray(row.soft_errors) ? row.soft_errors.length : 0,
        assertion_failure_count: assertionFailures,
        browser: row.browser,
        execution_mode: row.execution_mode ?? 'procedural',
        date_bucket: dateBucket(row.completed_at),
        source,
      };

      writeJsonl(streams.flakeRuns, record);
      counters.totalRuns += 1;
      if (record.is_flaky) counters.totalFlaky += 1;
      bumpSource(counters, source, 'runs');
      if (record.is_flaky) bumpSource(counters, source, 'flaky');
      if (triageClass) counters.triageDist[triageClass] = (counters.triageDist[triageClass] ?? 0) + 1;
      if (category) counters.errorCategoryDist[category] = (counters.errorCategoryDist[category] ?? 0) + 1;
    }
    if (rows.length < CHUNK) break;
  }
  console.log(`[${source}] flake_runs: emitted ${counters.perSource[source]?.runs ?? 0} rows`);
  void total;
}

async function pass2VisualDiffs(
  sql: ReturnType<typeof makeClient>,
  source: SourceName,
  streams: Streams,
  counters: Counters,
  includedTeams: Set<string>,
): Promise<void> {
  const CHUNK = 1000;
  let lastId: string | null = null;
  while (true) {
    const rows = await sql<
      Array<{
        id: string;
        test_id: string;
        team_id: string | null;
        status: string;
        classification: string | null;
        pixel_difference: number | null;
        percentage_difference: string | null;
        metadata: {
          changedRegions?: unknown[];
          pageShift?: { detected?: boolean } | null;
          textRegionDiffPixels?: number;
          nonTextRegionDiffPixels?: number;
          domDiff?: { added?: unknown[]; removed?: unknown[]; changed?: unknown[] } | null;
        } | null;
        ai_analysis: { classification?: string; confidence?: number } | null;
        ai_recommendation: string | null;
        browser: string | null;
        created_at: Date | null;
      }>
    >`
      select vd.id,
             vd.test_id,
             r.team_id,
             vd.status,
             vd.classification,
             vd.pixel_difference,
             vd.percentage_difference,
             vd.metadata,
             vd.ai_analysis,
             vd.ai_recommendation,
             vd.browser,
             vd.created_at
      from visual_diffs vd
      left join tests t on t.id = vd.test_id
      left join repositories r on r.id = t.repository_id
      ${lastId ? sql`where vd.id > ${lastId}` : sql``}
      order by vd.id
      limit ${CHUNK}
    `;
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      if (!row.team_id || !includedTeams.has(row.team_id)) continue;
      const md = row.metadata ?? {};
      const totalDiff = (md.textRegionDiffPixels ?? 0) + (md.nonTextRegionDiffPixels ?? 0);
      const textPct = totalDiff > 0 ? (md.textRegionDiffPixels ?? 0) / totalDiff : null;
      const nonTextPct = totalDiff > 0 ? (md.nonTextRegionDiffPixels ?? 0) / totalDiff : null;
      const dom = md.domDiff;
      const domDiffPresent = !!dom && (
        (Array.isArray(dom.added) && dom.added.length > 0) ||
        (Array.isArray(dom.removed) && dom.removed.length > 0) ||
        (Array.isArray(dom.changed) && dom.changed.length > 0)
      );

      const record = {
        diff_id_hash: hashId(row.id, 'diff'),
        test_id_hash: hashId(row.test_id, 'test'),
        team_id_hash: hashId(row.team_id, 'team'),
        classification: row.classification,
        ai_classification: row.ai_analysis?.classification ?? null,
        ai_confidence: typeof row.ai_analysis?.confidence === 'number' ? row.ai_analysis.confidence : null,
        ai_recommendation: row.ai_recommendation,
        pixel_difference: row.pixel_difference ?? 0,
        percentage_difference:
          row.percentage_difference != null ? parseFloat(row.percentage_difference) : null,
        changed_region_count: Array.isArray(md.changedRegions) ? md.changedRegions.length : null,
        page_shift_detected: md.pageShift?.detected ?? null,
        text_region_diff_pct: textPct,
        non_text_region_diff_pct: nonTextPct,
        dom_diff_present: domDiffPresent,
        status: row.status,
        browser: row.browser,
        date_bucket: dateBucket(row.created_at),
        source,
      };
      writeJsonl(streams.visualDiffs, record);
      bumpSource(counters, source, 'diffs');
      if (row.classification) {
        counters.diffClassDist[row.classification] =
          (counters.diffClassDist[row.classification] ?? 0) + 1;
      }
    }
    if (rows.length < CHUNK) break;
  }
  console.log(`[${source}] visual_diffs: emitted ${counters.perSource[source]?.diffs ?? 0} rows`);
}

async function pass3SelectorFragility(
  sql: ReturnType<typeof makeClient>,
  source: SourceName,
  streams: Streams,
  counters: Counters,
  includedTeams: Set<string>,
): Promise<void> {
  const CHUNK = 1000;
  let lastId: string | null = null;
  while (true) {
    const rows = await sql<
      Array<{
        id: string;
        test_id: string | null;
        team_id: string | null;
        selector_type: string | null;
        success_count: number | null;
        failure_count: number | null;
        total_attempts: number | null;
        avg_response_time_ms: number | null;
      }>
    >`
      select ss.id,
             ss.test_id,
             r.team_id,
             ss.selector_type,
             ss.success_count,
             ss.failure_count,
             ss.total_attempts,
             ss.avg_response_time_ms
      from selector_stats ss
      left join tests t on t.id = ss.test_id
      left join repositories r on r.id = t.repository_id
      ${lastId ? sql`where ss.id > ${lastId}` : sql``}
      order by ss.id
      limit ${CHUNK}
    `;
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      if (!row.team_id || !includedTeams.has(row.team_id)) continue;
      const successes = row.success_count ?? 0;
      const failures = row.failure_count ?? 0;
      const attempts = row.total_attempts ?? successes + failures;
      const failureRate = attempts > 0 ? failures / attempts : 0;
      const kind = classifySelectorKind(row.selector_type);

      const record = {
        selector_kind: kind,
        success_count: successes,
        failure_count: failures,
        total_attempts: attempts,
        failure_rate: Math.round(failureRate * 1000) / 1000,
        avg_response_time_ms: row.avg_response_time_ms,
        test_id_hash: hashId(row.test_id ?? null, 'test'),
        team_id_hash: hashId(row.team_id, 'team'),
        source,
      };
      writeJsonl(streams.selectorFragility, record);
      bumpSource(counters, source, 'selectors');
      const slot = (counters.selectorKindFailures[kind] ??= { failures: 0, attempts: 0 });
      slot.failures += failures;
      slot.attempts += attempts;
    }
    if (rows.length < CHUNK) break;
  }
  console.log(
    `[${source}] selector_fragility: emitted ${counters.perSource[source]?.selectors ?? 0} rows`,
  );
}

// ─── Summary ──────────────────────────────────────────────────────────

function buildSummary(counters: Counters, args: Args) {
  const topErrors = Object.entries(counters.errorCategoryDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([category, count]) => ({ category, count }));

  const selectorRanking = Object.entries(counters.selectorKindFailures)
    .map(([kind, { failures, attempts }]) => ({
      kind,
      failures,
      attempts,
      failure_rate: attempts > 0 ? Math.round((failures / attempts) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.failure_rate - a.failure_rate);

  return {
    generated_at: new Date().toISOString(),
    sources: args.sources,
    min_runs_per_team: args.minRunsPerTeam,
    totals: {
      runs: counters.totalRuns,
      flaky_runs: counters.totalFlaky,
      flake_rate: counters.totalRuns > 0 ? Math.round((counters.totalFlaky / counters.totalRuns) * 10000) / 10000 : 0,
    },
    triage_class_distribution: counters.triageDist,
    diff_classification_distribution: counters.diffClassDist,
    top_error_categories: topErrors,
    selector_kind_fragility_ranking: selectorRanking,
    per_source: counters.perSource,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  console.log(`Output: ${outDir}`);
  console.log(`Sources: ${args.sources.join(', ')}`);
  const streams = openStreams(outDir);
  const counters = newCounters();

  for (const source of args.sources) {
    try {
      await runSource(source, streams, counters, args.minRunsPerTeam);
    } catch (err) {
      console.error(`[${source}] failed:`, err instanceof Error ? err.message : err);
      if (args.sources.length === 1) {
        await closeStreams(streams);
        process.exit(1);
      }
    }
  }

  await closeStreams(streams);
  const summary = buildSummary(counters, args);
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\nDone. ${counters.totalRuns} runs (${counters.totalFlaky} flaky) across ${args.sources.length} source(s).`);
  console.log(`Summary: ${join(outDir, 'summary.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
