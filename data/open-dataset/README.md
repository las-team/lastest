# Lastest Flake Patterns: Open Dataset

A public, anonymized snapshot of UI test flake patterns observed by [Lastest](https://lastest.cloud) — a visual regression testing platform. We're publishing it because the public visual-testing space has almost no shared empirical data on _what_ actually flakes, _how often_, and _why_.

If you're researching test reliability, training a model, building a diagnostic tool, or just curious how often `data-testid` selectors actually work — this is for you.

## Files

| File                       | Records                     | What it is                                                                                                    |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `flake_runs.jsonl`         | 1 per non-retry test result | Outcome, retry count, scrubbed error signature, AI triage class, duration bucket.                             |
| `visual_diffs.jsonl`       | 1 per visual diff           | Pixel diff metrics, classification (unchanged/flaky/changed), AI analysis class, page-shift / DOM-diff flags. |
| `selector_fragility.jsonl` | 1 per (test, selector) pair | Success/failure counts by selector _kind_ — never the selector value itself.                                  |
| `summary.json`             | aggregate object            | Totals, distributions, top error categories, selector ranking.                                                |
| `schema.json`              | JSON Schema                 | Field types and value enums for all three record types.                                                       |

Each JSONL file is one record per line; load with `pd.read_json("flake_runs.jsonl", lines=True)` or any streaming reader.

## How it was anonymized

1. **All IDs hashed.** Every `*_id_hash` is `HMAC-SHA256(salt, "kind:value")` truncated to 16 hex chars. The salt is rotated per export, so hashes don't link across releases. Joins _within_ a release work (same `test_id_hash` across all three files for the same test).
2. **Error messages scrubbed.** Before export, `error_message` runs through a regex pipeline:
   - URLs → `<URL>`, emails → `<EMAIL>`
   - IPv4/IPv6 addresses → `<IP>`
   - UUIDs → `<UUID>`, hosts (`*.com|.io|.dev|...`) → `<HOST>`
   - quoted strings (likely selectors / values) → `<STR>`
   - long mixed-character tokens (40+ chars, looks like a hash/token) → `<HASH>`
   - whitespace collapsed, truncated to 500 chars.

   The cleaned signature is then matched against ~10 patterns to derive `error_category`.

3. **k-anonymity floor.** Any team contributing fewer than **50 runs** is dropped entirely. This protects small teams from re-identification through unique error signatures.
4. **Timestamps bucketed to YYYY-MM only.** No per-day temporal fingerprinting.
5. **Excluded fields** (never exported, even hashed): `target_url`, `base_url`, `git_branch`, `git_commit`, `repository.full_name`, screenshot/video/network-bodies file paths, console error contents, raw assertion strings, storage state contents, all auth tables, all selector _values_.
6. **Selector values never leave the DB.** Only `selector_kind` (testid / role / text / css / xpath / visual / other) and counts.

## License

**[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).** Use it however you want — research, products, papers, blog posts. Attribution required.

```
@misc{lastest_flake_2026,
  title  = {Lastest Flake Patterns: An Anonymized Open Dataset of UI Test Reliability Signals},
  author = {Lastest},
  year   = {2026},
  url    = {https://lastest.cloud/datasets/flake-patterns}
}
```

## Limitations

- **Single vendor.** All data comes from teams using Lastest, which biases toward web apps using Playwright + visual diffing. It is not representative of all UI tests in the wild.
- **No app-type stratification.** We don't tag whether a team is testing e-commerce vs. a B2B SaaS vs. a marketing site. Mixture is unknown.
- **AI triage labels are model-generated**, not human-verified. Use as a noisy signal, not ground truth.
- **`source` column** marks `local` (small dev-only sample) vs. `olares` (production customer data). For most analyses you'll want `source == 'olares'` only.

## Reproducibility

The exporter is open-source: [`scripts/export-flake-dataset.ts`](https://github.com/your-org/lastest/blob/main/scripts/export-flake-dataset.ts). It is read-only and emits this exact format. Run it against your own DB if you want to publish a sibling dataset.

## Feedback

File an issue at https://github.com/your-org/lastest/issues with the tag `dataset` if a field is unclear, you spot a leak, or you want a column added.
