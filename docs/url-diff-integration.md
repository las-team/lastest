# URL Diff — Integration Spec for `lastest.cloud` (`lastest-www`)

Audience: the team running the public marketing site / `/tools/url-diff` page.
Purpose: replace the standalone `checker-api` backend with calls to the Lastest
app's authenticated v1 API.

Status: stable for v1. Endpoints live in `src/app/api/v1/[...slug]/route.ts`.

---

## 1. What you get

Two endpoints that wrap Lastest's existing capture pipeline:

| Endpoint | Behaviour | Returns |
|---|---|---|
| `POST /api/v1/snapshot` | Synchronous single-URL capture (~10–30 s) | Inline JSON with screenshotUrl + DOM + network + axe-core violations + WCAG score |
| `POST /api/v1/diff` | Async two-URL diff (~20–60 s) | `{ jobId, statusUrl }` — poll `statusUrl` until `status === 'completed'` |

Captured artefacts:

- **Visual** — full-page PNG, plus four diff variants: pixelmatch, pixelmatch with page-shift alignment, SSIM, butteraugli.
- **DOM** — flat element index with multi-strategy selectors and bounding boxes.
- **Network** — request list with method/status/duration/resourceType/responseSize/failed (no bodies in v1).
- **Accessibility** — full axe-core 4.11 violation list + pass count + Lastest WCAG score (0–100). Tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`.
- **Page text** — `document.body.innerText` snapshot for line-level text diff.

Stateless: artefacts live under `storage/url-diffs/<jobId>/` and are reaped after **1 hour**. Don't treat snapshot IDs as durable references.

---

## 2. Authentication

Send `Authorization: Bearer <LASTEST_API_KEY>` on every request.

- Tokens are issued from the app under **Settings → Runners & API Access** (or `verifyBearerToken` in `src/lib/auth/api-key.ts`).
- The token is team-scoped. All captures are recorded under the issuing team's `background_jobs.metadata.teamId` for audit/quota.
- The same token works for `GET /api/jobs/<jobId>` (used to poll the diff status).

```http
POST /api/v1/snapshot
Host: app.lastest.cloud
Authorization: Bearer ltk_a1b2c3...
Content-Type: application/json
```

---

## 3. Rate limiting

- **5 requests per minute** per `(source IP, user)` pair on both `POST /snapshot` and `POST /diff`.
- 429 response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (unix seconds), and `Retry-After` (seconds).
- Counters live in-memory on the server pod; bursts may be tighter on cluster restarts.

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1762520760
Retry-After: 47

{ "error": "Rate limit exceeded" }
```

---

## 4. SSRF policy

Bearer-token requests **cannot** target private/loopback/link-local/cloud-metadata addresses by default. The block covers:

- IPv4: `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `0/8`, `100.64/10`, `198.18/15`, `224/4`, `240/4`
- IPv6: `::1/128`, `fc00::/7`, `fe80::/10`
- Hostname suffixes: `localhost`, `*.localhost`, `*.internal`, `*.local`
- DNS-rebinding pre-flight: every A/AAAA record must clear the block.

Bypass options (configured server-side in the deployed Lastest pod):

| Env | Effect |
|---|---|
| `URL_DIFF_ALLOW_PRIVATE_HOSTS=true` | Disables the block entirely. Use only for fully-internal deployments. |
| `URL_DIFF_PRIVATE_HOST_IP_ALLOWLIST=<cidr,...>` | Source IPs in this list can target private hosts. |

Cookie-session (in-app) users always bypass. Bearer requests do not.

Failure shape:

```json
{ "error": "Target host telex.hu resolves to a private/internal address (10.0.0.5)" }
```
Status: `400 Bad Request`.

---

## 5. `POST /api/v1/snapshot` — single URL

Synchronous. Returns when the capture completes (or fails).

### Request

```json
{
  "url": "https://example.com",
  "viewport": { "width": 1280, "height": 720 }   // optional; default 1280x720
}
```

### Response (200)

```json
{
  "snapshotId": "f1b2c3d4-...",
  "screenshotUrl": "/api/media/url-diffs/f1b2.../a/screenshot.png",
  "domSnapshot": {
    "elements": [ { "tag": "...", "selectors": [...], ... } ],
    "url": "https://example.com",
    "timestamp": 1762520000000
  },
  "networkRequests": [
    {
      "url": "https://example.com/",
      "method": "GET",
      "status": 200,
      "duration": 142,
      "resourceType": "document",
      "responseSize": 18432,
      "failed": false
    }
  ],
  "a11yViolations": [
    {
      "id": "image-alt",
      "impact": "serious",
      "description": "...",
      "help": "...",
      "helpUrl": "https://dequeuniversity.com/...",
      "nodes": 3,
      "tags": ["wcag2a"],
      "wcagLevel": "A"
    }
  ],
  "a11yPassesCount": 47,
  "wcagScore": {
    "score": 82,
    "totalRules": 60,
    "passedRules": 47,
    "violatedRules": 13,
    "bySeverity": { "critical": 0, "serious": 3, "moderate": 6, "minor": 4 }
  },
  "capturedAt": 1762520012345
}
```

`screenshotUrl` is a relative path. To fetch the binary, prepend the app origin and re-send the bearer token:

```bash
curl -H "Authorization: Bearer $LASTEST_API_KEY" \
     "https://app.lastest.cloud/api/media/url-diffs/<id>/a/screenshot.png" \
     -o screenshot.png
```

The `accessibilityTree` (Playwright `page.accessibility.snapshot()`) is **not** included in the API response — it can be 10+ MB. If you need it, fetch `/api/media/url-diffs/<id>/a/a11y-tree.json` directly.

### Errors

| Status | When |
|---|---|
| `400` | Missing/invalid `url`, SSRF block, validation failure |
| `401` | Missing/invalid bearer |
| `403` | Token has no team |
| `429` | Rate limited |
| `502` | Capture failed (EB pool exhaustion, target site error, axe failure). `error` carries the message. |

---

## 6. `POST /api/v1/diff` — two URLs

Asynchronous. Returns a `jobId` immediately; you poll for the final result.

### Request

```json
{
  "urlA": "https://staging.example.com",
  "urlB": "https://www.example.com",
  "viewport": { "width": 1280, "height": 720 }
}
```

Optional snapshot reuse — when both `snapshotIdA` and `snapshotIdB` are supplied (and still on disk; TTL is 1 h), the endpoint **skips capture** and runs the diff synchronously, returning the full result inline:

```json
{
  "snapshotIdA": "f1b2...",
  "snapshotIdB": "9c8d..."
}
```

### Response (202)

```json
{
  "jobId": "1f2e3d4c-...",
  "statusUrl": "/api/v1/jobs/1f2e3d4c-..."
}
```

### Polling

```bash
curl -H "Authorization: Bearer $LASTEST_API_KEY" \
     "https://app.lastest.cloud/api/jobs/1f2e3d4c-..."
```

Returns a `BackgroundJob` row:

```json
{
  "id": "1f2e3d4c-...",
  "type": "url_diff",
  "status": "running",                    // "pending" | "running" | "completed" | "failed"
  "progress": 50,
  "completedSteps": 2,
  "totalSteps": 4,
  "label": "URL Diff: https://staging… vs https://www…",
  "error": null,
  "metadata": { "urlA": "...", "urlB": "...", "teamId": "..." }
}
```

When `status === "completed"`, `metadata.urlDiffResult` holds the full diff payload (see §7). When `status === "failed"`, `error` carries a single-line message.

Recommended polling cadence: **every 2 s**, up to 90 s. Bail with a friendly error after that.

---

## 7. `urlDiffResult` shape (what the Diff tab renders)

```ts
interface UrlDiffResult {
  visual: {
    baselineRelPath: string;     // /url-diffs/<job>/a/screenshot.png
    currentRelPath: string;      // /url-diffs/<job>/b/screenshot.png
    defaultKey: 'pixelmatch' | 'pixelmatch-shift' | 'ssim' | 'butteraugli';
    variants: Array<{
      key: 'pixelmatch' | 'pixelmatch-shift' | 'ssim' | 'butteraugli';
      label: string;
      diffRelPath: string;       // /url-diffs/<job>/diff/<key>/diff-<ts>.png
      pixelDifference: number;
      percentageDifference: number;  // % of content area
    }>;
    diffRelPath: string;         // back-compat: mirrors variants[0]
    pixelDifference: number;
    percentageDifference: number;
    metadata: {                  // change classification + region detection
      changedRegions: Array<{ x, y, width, height, pixelCount }>;
      affectedComponents?: string[];
      changeCategories?: { layout: number; color: number; text: number; ... };
      pageShift?: { detected: boolean; offsetY?: number };
    };
  };

  dom: {
    added: DomSnapshotElement[];
    removed: DomSnapshotElement[];
    changed: Array<{ baseline: DomSnapshotElement; current: DomSnapshotElement; changes: string[] }>;
    unchangedCount: number;
    summary: string;             // human-readable text summary
  };

  network: {
    added: NetworkDiffEntry[];           // in B not A
    removed: NetworkDiffEntry[];         // in A not B
    changedStatus: NetworkDiffEntry[];
    changedSize: NetworkDiffEntry[];     // |Δbytes|/max > 10%
    slowdowns: NetworkDiffEntry[];       // duration_b > duration_a + 200ms AND > 1.5×
    failedA: NetworkDiffEntry[];
    failedB: NetworkDiffEntry[];
    summary: {
      countA: number; countB: number;
      bytesA: number; bytesB: number;
      byTypeA: Record<string, number>;
      byTypeB: Record<string, number>;
      thirdPartyDomainsA: string[];      // suffix-after-dot match against urlA host
      thirdPartyDomainsB: string[];
      failedCountA: number;
      failedCountB: number;
    };
  };

  a11y: {
    newInB: A11yViolation[];     // rule appears in B not A (regression)
    fixedInB: A11yViolation[];   // rule disappears (improvement)
    regressed: Array<{ ruleId; impact; nodesA; nodesB }>;  // same rule, more nodes
    improved:  Array<{ ruleId; impact; nodesA; nodesB }>;
    scoreA: WcagScoreSummary;
    scoreB: WcagScoreSummary;
    scoreDelta: number;          // scoreB - scoreA
  };

  text: {
    status: 'unchanged' | 'changed' | 'baseline_only' | 'current_only' | 'skipped';
    summary: { added: number; removed: number; sameAsBaseline: boolean };
    lines: Array<{ op: 'add' | 'del' | 'eq'; line: string; oldLineNo?: number; newLineNo?: number }>;
    baselineText: string | null; // raw text dumps
    currentText: string | null;
  };

  capturedAtA: number;
  capturedAtB: number;
  primaryHostA: string;
  primaryHostB: string;
}
```

### Network match key

Requests are matched by `${method} ${normalizeUrl(url)}`. `normalizeUrl` strips cache-busting nonces (`_t`, `cb`, `_`, `v`, `ts`, `nocache`, plus any param matching `/^[a-f0-9]{12,}$/i`) and sorts remaining params. Identical resources behind different cache-buster values still align.

### Third-party classification

Spec-acknowledged limitation: suffix-after-dot only. `cdn.example.com` is first-party for `example.com`; `foo-example.com` is third-party. PSL-aware classification is deferred.

### WCAG score formula

`100 − Σ severity × min(nodes, 3) × levelMultiplier`, clamped to `[0,100]`. Severity weights: `critical=10`, `serious=5`, `moderate=2`, `minor=1`. Level multipliers: `A=1.5`, `AA=1.0`, `AAA=0.5`. See `src/lib/a11y/wcag-score.ts`.

---

## 8. Fetching media (screenshots, diff PNGs, raw text)

All artefact paths returned in the response (e.g. `screenshotUrl`, `visual.diffRelPath`) are served by `/api/media/[...path]`. Auth applies: send the bearer.

The media route validates that the requesting team owns the parent `background_jobs` row (via `metadata.teamId` for repo-less URL Diff jobs).

```bash
curl -H "Authorization: Bearer $LASTEST_API_KEY" \
     "https://app.lastest.cloud/api/media/url-diffs/<jobId>/diff/pixelmatch/diff-1762520012345.png" \
     -o diff.png
```

If the artefact has been reaped (>1 h), you'll get `404`. Restart the diff.

---

## 9. End-to-end example (Node, fetch)

```ts
const ORIGIN = 'https://app.lastest.cloud';
const TOKEN  = process.env.LASTEST_API_KEY!;

async function diffUrls(urlA: string, urlB: string) {
  // 1. Kick off
  const start = await fetch(`${ORIGIN}/api/v1/diff`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ urlA, urlB }),
  });
  if (!start.ok) throw new Error(`diff start: ${start.status} ${await start.text()}`);
  const { jobId } = await start.json();

  // 2. Poll
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`${ORIGIN}/api/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`poll: ${res.status}`);
    const job = await res.json();
    if (job.status === 'completed') return job.metadata.urlDiffResult;
    if (job.status === 'failed')   throw new Error(job.error ?? 'diff failed');
  }
  throw new Error('diff timed out');
}
```

---

## 10. Phasing the migration off `checker-api`

The website spec lists Phase 4 as "the public tool flips to call Lastest's API directly." This document is what unblocks that flip.

Suggested staged rollout for the `lastest-www` page:

1. **Shadow** — keep `checker-api` as the primary; on every submission, `Promise.all` it with a Lastest call and log diffs. Identify any field-shape mismatches.
2. **Cut over** — switch the primary to Lastest, leave `checker-api` as a fallback for one week.
3. **Retire** — remove `checker-api`. Drop the heuristic WCAG check from the frontend (real axe-core comes from Lastest now).
4. **Promote new features** — surface the four visual variants, page-text diff, and snapshot-reuse permalinks (within the 1 h TTL).

The frontend's existing `DiffResults` component already maps cleanly to fields above (DOM, Network, A11y, WCAG). The visual block needs a small extension to render the four variants from `visual.variants[]`. The text-diff is new.

---

## 11. What's NOT in v1

- **Authenticated/cookied page captures.** v1 navigates to a URL with no storage state. The spec's "auth flow" feature requires shipping a `storageState` payload through `/api/v1/snapshot` — deferred.
- **Multi-viewport in one call.** A single capture is one viewport. To compare three viewports, fire three diff jobs.
- **Persistent diff history / permalinks beyond 1 h.** Stateless by design; revisit after the lastest-www adoption metrics land.
- **Real-user CDN/PSL parsing.** Suffix-after-dot only.
- **Color-contrast checks** at the layout level. axe-core's contrast rule is included but its accuracy is bounded by what runs in headless Chromium without a real renderer pipeline.

Track follow-on capability planning in `src/lib/url-diff/` — additions land as additive fields on `UrlDiffResult` to keep the API back-compat.

---

## 12. Known operational gotchas

- **First request after pod cold-start** can take longer (axe-core import warm-up, EB warm-pool spin-up). Build your timeout floor at ≥ 90 s.
- **Pool exhaustion** surfaces as `502` on `/snapshot` or `status: "failed"` with `error: "EB unavailable: pool at capacity"` on `/diff`. Retry after a short backoff or notify the user. Do not retry 429s without honouring `Retry-After`.
- **Sites that block headless Chromium** show up as either a `failed` capture or a near-blank screenshot. We add a "blank-PNG tripwire" so you'll get `Capture produced suspicious blank screenshot` rather than a misleading green pass.
- **Stabilization is on by default** (`freezeAnimations`, `freezeRandomValues`, `freezeTimestamps`). Some sites break under it; if you see consistent capture failures on a known-good URL, file an issue with the URL so we can add a per-target opt-out.
