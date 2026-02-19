import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { generateDiff } from './generator';
import type { DiffResult } from './generator';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SS = path.resolve('storage/screenshots/c8fc9e1c-413d-4013-9920-cdbab5fe7f0c');
const DD = path.resolve('storage/diffs');
const TEMP_DIR = path.resolve('__temp_benchmark__');

// ---------------------------------------------------------------------------
// 10 image pairs
// ---------------------------------------------------------------------------
interface ImagePair {
  label: string;
  baseline: string;
  current: string;
  description: string;
}

const PAIRS: ImagePair[] = [
  {
    label: 'identical-same-height',
    baseline: path.join(SS, '02110815-d9f9-4b30-bb81-ccd8fba5ddbb-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    current:  path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    description: '1440x6661 vs 1440x6661 — same test, two runs',
  },
  {
    label: 'near-identical-third-run',
    baseline: path.join(SS, '02110815-d9f9-4b30-bb81-ccd8fba5ddbb-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    current:  path.join(SS, '0ff4bddc-78a5-4edd-a813-97bd6033fca5-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    description: '1440x6661 vs 1440x6661 — third run, flakiness probe',
  },
  {
    label: 'height-diff-29px',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-1296b7c5-1140-4629-8f8e-127421417465.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-1296b7c5-1140-4629-8f8e-127421417465.png'),
    description: '1440x7826 vs 1440x7855 — tiny height diff (29px)',
  },
  {
    label: 'height-diff-133px',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-3179cc8b-5366-456f-8577-2729d960c391.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-3179cc8b-5366-456f-8577-2729d960c391.png'),
    description: '1440x6150 vs 1440x6017 — medium height diff (133px)',
  },
  {
    label: 'height-diff-206px',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-71e949dd-b794-4c1b-9d27-5777b918bd2c.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-71e949dd-b794-4c1b-9d27-5777b918bd2c.png'),
    description: '1440x2477 vs 1440x2271 — larger height diff (206px)',
  },
  {
    label: 'height-diff-343px',
    baseline: path.join(SS, '02110815-d9f9-4b30-bb81-ccd8fba5ddbb-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    description: '1440x6661 vs 1440x6318 — significant height shrink (343px)',
  },
  {
    label: 'width+height-diff',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-3bb40151-c9ac-4aa2-8080-6aaaee61f2f4.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-3bb40151-c9ac-4aa2-8080-6aaaee61f2f4.png'),
    description: '1452x7009 vs 1440x6795 — width (-12px) AND height (-214px)',
  },
  {
    label: 'mobile-vs-desktop',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-cac7b0bf-e98e-4c61-8d10-bb6116bb2fb6-mobile.png'),
    current:  path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-cac7b0bf-e98e-4c61-8d10-bb6116bb2fb6.png'),
    description: '375x15016 vs 1440x10419 — completely different dimensions',
  },
  {
    label: 'mobile-identical',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-cac7b0bf-e98e-4c61-8d10-bb6116bb2fb6-mobile.png'),
    current:  path.join(SS, 'f9d5471d-bacc-455a-913c-aca65efb2de2-cac7b0bf-e98e-4c61-8d10-bb6116bb2fb6-mobile.png'),
    description: '375x15016 vs 375x15016 — mobile viewport, same height',
  },
  {
    label: 'aligned-pair',
    baseline: path.join(DD, 'aligned-baseline-1771443466123.png'),
    current:  path.join(DD, 'aligned-current-1771443466123.png'),
    description: 'Pre-aligned pair from storage/diffs — pure pixelmatch benchmark',
  },
];

// ---------------------------------------------------------------------------
// 6 settings combinations
// ---------------------------------------------------------------------------
interface SettingsCombo {
  key: string;
  label: string;
  threshold: number;
  includeAntiAliasing: boolean;
  ignorePageShift: boolean;
}

const SETTINGS: SettingsCombo[] = [
  { key: 'S1', label: 'default',     threshold: 0.10, includeAntiAliasing: false, ignorePageShift: false },
  { key: 'S2', label: 'sensitive',   threshold: 0.01, includeAntiAliasing: false, ignorePageShift: false },
  { key: 'S3', label: 'tolerant',    threshold: 0.30, includeAntiAliasing: false, ignorePageShift: false },
  { key: 'S4', label: 'AA-aware',    threshold: 0.10, includeAntiAliasing: true,  ignorePageShift: false },
  { key: 'S5', label: 'shift-aware', threshold: 0.10, includeAntiAliasing: false, ignorePageShift: true  },
  { key: 'S6', label: 'shift+AA',    threshold: 0.10, includeAntiAliasing: true,  ignorePageShift: true  },
];

// ---------------------------------------------------------------------------
// Report collection
// ---------------------------------------------------------------------------
interface BenchmarkResult {
  pairLabel: string;
  pairDescription: string;
  settingsKey: string;
  settingsLabel: string;
  pixelDiff: number;
  percentDiff: number;
  classification: 'unchanged' | 'flaky' | 'changed';
  shiftDetected: boolean;
  insertedRows: number;
  deletedRows: number;
  durationMs: number;
  error?: string;
}

const REPORT: BenchmarkResult[] = [];

function classify(pct: number): 'unchanged' | 'flaky' | 'changed' {
  if (pct <= 1) return 'unchanged';
  if (pct <= 10) return 'flaky';
  return 'changed';
}

// ---------------------------------------------------------------------------
// Check if all image files exist — skip gracefully in CI
// ---------------------------------------------------------------------------
function pairFilesExist(pair: ImagePair): boolean {
  return fs.existsSync(pair.baseline) && fs.existsSync(pair.current);
}

const allPairsAvailable = PAIRS.every(pairFilesExist);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe.skipIf(!allPairsAvailable)('Diff Engine Benchmark', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // ─── Section 1: Per-pair table ───
    console.log('\n\n' + '='.repeat(120));
    console.log('  DIFF ENGINE BENCHMARK REPORT');
    console.log('='.repeat(120));

    for (const pair of PAIRS) {
      const rows = REPORT.filter(r => r.pairLabel === pair.label);
      if (rows.length === 0) continue;

      console.log(`\n▸ ${pair.label} — ${pair.description}`);
      console.table(
        rows.map(r => ({
          Settings: `${r.settingsKey} (${r.settingsLabel})`,
          'Pixel Diff': r.error ? 'ERROR' : r.pixelDiff.toLocaleString(),
          '% Diff': r.error ? r.error : `${r.percentDiff}%`,
          Classification: r.classification,
          'Shift?': r.shiftDetected ? 'YES' : '-',
          'Ins/Del Rows': r.insertedRows || r.deletedRows ? `+${r.insertedRows}/-${r.deletedRows}` : '-',
          'Duration': `${r.durationMs}ms`,
        }))
      );
    }

    // ─── Section 2: Classification change matrix ───
    console.log('\n' + '-'.repeat(120));
    console.log('  CLASSIFICATION CHANGE MATRIX (vs S1 default)');
    console.log('-'.repeat(120));

    const matrix: Record<string, Record<string, string>> = {};
    for (const pair of PAIRS) {
      const rows = REPORT.filter(r => r.pairLabel === pair.label);
      const s1 = rows.find(r => r.settingsKey === 'S1');
      if (!s1) continue;

      const changes: Record<string, string> = {};
      let hasChange = false;
      for (const r of rows) {
        if (r.settingsKey === 'S1') continue;
        if (r.classification !== s1.classification) {
          changes[r.settingsKey] = `${s1.classification} → ${r.classification}`;
          hasChange = true;
        } else {
          changes[r.settingsKey] = '(same)';
        }
      }
      if (hasChange) {
        matrix[pair.label] = changes;
      }
    }

    if (Object.keys(matrix).length === 0) {
      console.log('  No classification changes across any settings.\n');
    } else {
      for (const [label, changes] of Object.entries(matrix)) {
        console.log(`  ${label}:`);
        for (const [key, val] of Object.entries(changes)) {
          console.log(`    ${key}: ${val}`);
        }
      }
    }

    // ─── Section 3: Page shift impact (S1 vs S5) ───
    console.log('\n' + '-'.repeat(120));
    console.log('  PAGE SHIFT IMPACT (S1 default vs S5 shift-aware)');
    console.log('-'.repeat(120));

    const shiftImpact: Array<{
      pair: string;
      s1Pct: number;
      s5Pct: number;
      delta: number;
      verdict: string;
    }> = [];

    for (const pair of PAIRS) {
      const rows = REPORT.filter(r => r.pairLabel === pair.label);
      const s1 = rows.find(r => r.settingsKey === 'S1');
      const s5 = rows.find(r => r.settingsKey === 'S5');
      if (!s1 || !s5 || s1.error || s5.error) continue;

      const delta = s1.percentDiff - s5.percentDiff;
      shiftImpact.push({
        pair: pair.label,
        s1Pct: s1.percentDiff,
        s5Pct: s5.percentDiff,
        delta: Math.round(delta * 100) / 100,
        verdict: delta > 0.5 ? 'HELPS' : delta < -0.5 ? 'HURTS' : 'NEUTRAL',
      });
    }

    console.table(shiftImpact);

    console.log('\n' + '='.repeat(120) + '\n');

    // Clean up temp dir
    try {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // Generate tests: 10 pairs × 6 settings = 60 tests
  for (const pair of PAIRS) {
    describe(pair.label, () => {
      for (const settings of SETTINGS) {
        it(`${settings.key} (${settings.label})`, async () => {
          if (!pairFilesExist(pair)) {
            REPORT.push({
              pairLabel: pair.label,
              pairDescription: pair.description,
              settingsKey: settings.key,
              settingsLabel: settings.label,
              pixelDiff: 0,
              percentDiff: 0,
              classification: 'unchanged',
              shiftDetected: false,
              insertedRows: 0,
              deletedRows: 0,
              durationMs: 0,
              error: 'FILES_MISSING',
            });
            return;
          }

          const outDir = path.join(TEMP_DIR, `${pair.label}-${settings.key}`);

          const start = performance.now();
          let result: DiffResult;
          try {
            result = await generateDiff(
              pair.baseline,
              pair.current,
              outDir,
              settings.threshold,
              settings.includeAntiAliasing,
              undefined, // ignoreRegions
              settings.ignorePageShift,
            );
          } catch (err) {
            const durationMs = Math.round(performance.now() - start);
            REPORT.push({
              pairLabel: pair.label,
              pairDescription: pair.description,
              settingsKey: settings.key,
              settingsLabel: settings.label,
              pixelDiff: 0,
              percentDiff: 0,
              classification: 'changed',
              shiftDetected: false,
              insertedRows: 0,
              deletedRows: 0,
              durationMs,
              error: (err as Error).message.slice(0, 80),
            });
            // Don't fail — record the error and move on
            return;
          }
          const durationMs = Math.round(performance.now() - start);

          const ps = result.metadata.pageShift;
          REPORT.push({
            pairLabel: pair.label,
            pairDescription: pair.description,
            settingsKey: settings.key,
            settingsLabel: settings.label,
            pixelDiff: result.pixelDifference,
            percentDiff: result.percentageDifference,
            classification: classify(result.percentageDifference),
            shiftDetected: ps?.detected ?? false,
            insertedRows: ps?.insertedRows ?? 0,
            deletedRows: ps?.deletedRows ?? 0,
            durationMs,
          });

          // Basic sanity assertions — no crash + valid range
          expect(result.pixelDifference).toBeGreaterThanOrEqual(0);
          expect(result.percentageDifference).toBeGreaterThanOrEqual(0);
          expect(result.percentageDifference).toBeLessThanOrEqual(100);
          expect(result.diffImagePath).toBeTruthy();
        }, 60_000); // 60s timeout per test
      }
    });
  }
});
