# Mobile testing PoC — findings (issue #197)

**Question:** Can Lastest cleanly include mobile (Maestro) testing, or does it
require fundamental refactoring? Target: emulators/simulators, local only.

**Short answer:** The core runner protocol is **engine-agnostic and accepts a
non-Playwright mobile runner with essentially no host changes.** Real mobile
*execution* is very achievable. The hard, refactor-shaped work is entirely in
the **result/verify model and live streaming** — not in the protocol or dispatch.

Below, ✅ = proven working in this PoC, ⚠️ = works with a caveat/small change,
❌ = needs real design work.

---

## 1. The embedded-browser "protocol" is not browser-specific ✅

The host↔runner contract is **plain JSON over HTTP polling**, defined by:

- `POST /api/embedded/auto-register` → `{ runnerId, token, sessionId }`
- long-poll `POST /api/ws/runner` with `status:heartbeat` → returns `{ commands }`
- runner POSTs typed responses: `response:command_ack`, `response:screenshot`,
  `response:test_result`, …

Nothing in the transport requires Chromium, CDP, or Playwright. The
`command:run_test` payload carries an **opaque `code` string** — the host does
not parse or care what language it is until the *runner's own executor* runs it.
Our `maestro-app-runner` treats that `code` as **Maestro YAML** instead of
Playwright JS and the host is none the wiser.

**Proven:** `maestro-app-runner` (≈300 lines, no Playwright dependency)
registered as a system runner and long-polls for commands against an unmodified
host. See `src/index.ts`.

> Implication: the ticket's "fake EB that accepts non-playwright code" step is
> not just feasible — it's a natural consequence of how the protocol is shaped.

## 2. Capability-based routing already exists ⚠️

Projects are "always Maestro or Playwright, never mixed" (per the ticket). Lastest
already has the primitive to express this:

- `runners.capabilities: RunnerCapability[]` (today `["run","record"]`)
- `tests.requiredCapabilities`
- dispatch already filters: `caps.includes(capability)` in
  `src/server/actions/runners.ts:488`

Adding a `"maestro"` capability means:
1. widen the `RunnerCapability` union (1 line),
2. let `auto-register` accept a capability set instead of hardcoding
   `["run","record"]` (`src/app/api/embedded/auto-register/route.ts:180`),
3. tag Maestro projects/tests with `requiredCapabilities: ["maestro"]`.

No new subsystem. This is the mechanism the platform was already built around.

## 3. The k8s EB provisioner is coupled to registration ⚠️ (dev-env finding)

With `EB_PROVISIONER=kubernetes` + `EB_DEV_PORT_FORWARD=1`, `auto-register`
**returned 500** for our non-containerized runner: the warm-pool reconciler and
`rewriteDevStreamUrl` assume every registering EB is a k8s-managed pod and shell
out to `kubectl port-forward`/`get pod`, which fails when there is no cluster.

Setting `EB_PROVISIONER=none` + `EB_DEV_PORT_FORWARD=0` made registration
succeed immediately (`auto-register 200`). **The ticket scopes mobile to
"local only / no containerization," which is exactly the `none` provisioner
mode** — so this is not a blocker, but a real integration must ensure the
manual/local runner path doesn't route through the k8s provisioner. This is the
one place the current code assumes "EB == containerized Chromium pod."

## 4. Full protocol round-trip with a non-Playwright runner ✅ (proven)

Dispatched a real `command:run_test` to the registered `maestro-app-runner`
whose `code` payload was **Maestro YAML** (`flows/counter.yaml`), via the normal
`runner_commands` queue. Observed, against an **unmodified host**:

- host log: `Returning 1 claimed commands: [ 'command:run_test' ]`
- command row lifecycle: `pending → dispatched → claimed → completed`
- host stored **both** runner responses in `runner_command_results`:
  `response:screenshot` **and** `response:test_result`.

i.e. the host accepted a screenshot + pass/fail from a runner that has no
Playwright/Chromium anywhere in it, carrying a Maestro flow it never parsed.
**This is the central PoC result:** the embedded-browser protocol is genuinely
engine-agnostic. (Run in `RUNNER_MODE=fake`, so no device was driven for this
specific proof — see §4b for the real Maestro/simulator half.)

## 4b. Real Maestro execution on the iOS simulator — environment constraint ⚠️

Toolchain reality on this machine:

- **Maestro 2.8.0** runs (needed JDK 17; system Java was 13 — installed
  `openjdk@17`). Homebrew's Maestro formula was itself blocked by an unrelated
  **Xcode-version gate**, so it was installed via the official installer.
- **Xcode 16.4 / Swift 6.1.2.** The *latest* Expo (SDK 57 / RN 0.86) **fails to
  compile** here: `package 'apple' is using Swift tools version 6.2.0 but the
  installed version is 6.1.0` — it needs Xcode 26. Downgraded the test app to
  **Expo SDK 51 / RN 0.74**, which builds on Xcode 16.4.

Takeaway for the platform: iOS mobile testing inherits the host's Xcode/Swift
version coupling for *building the app under test*. Maestro itself only needs a
booted simulator + a built `.app`; the version sensitivity is in the RN build,
not in Maestro or the runner protocol.

## 4c. REAL end-to-end run on the iOS simulator ✅ (proven)

Because the RN app wouldn't build here (§4b), the real run drove the **built-in
iOS Settings app** (`com.apple.Preferences`) — this isolates the thing under
test (Maestro↔sim↔runner↔host) from the incidental RN toolchain problem.

Flow (`flows/ios-settings.yaml`): launch Settings → assert → tap General → tap
About → assert → back → back → assert, with a screenshot at each stage.

Result of `RUNNER_MODE=real` dispatched via `command:run_test` from the host:

- Maestro ran all steps `COMPLETED` on iPhone 16 / iOS 18.5 (67s).
- runner reported `response:test_result status=passed screenshotCount=4`.
- host stored **4 real device PNGs** (1178×2556, 170–217 KB) in its normal
  `storage/screenshots/` pipeline — same path browser screenshots take. The
  `response:screenshot` handler wrote the bytes to disk and swapped the inline
  base64 for a `path`, exactly as it does for the real EB.

So the **entire loop** works with an unmodified host: host → `run_test`
(Maestro YAML) → runner → real `maestro test` on the simulator → real
screenshots + pass/fail → host storage. The only host-side accommodation was
`EB_PROVISIONER=none` (§3), which is the correct mode for local/non-containerized
runners anyway.

## 5. Where the refactor actually is: the result/verify model ❌

This is the honest "requires design work" part. The host's `response:test_result`
and the whole **verify** subsystem are shaped around browser artifacts that
Maestro does not produce in the same form:

| Verify layer | Browser (today) | Maestro | Verdict |
|--------------|-----------------|---------|---------|
| visual       | screenshot PNG + pixel diff | ✅ Maestro `takeScreenshot` PNGs | **maps cleanly** |
| text         | page innerText | ⚠️ Maestro view-hierarchy text (different shape) | adapter needed |
| dom          | DOM selector snapshot | ⚠️ Maestro view hierarchy (native, not DOM) | different tree model |
| a11y         | axe-core WCAG tree | ❌ no web a11y tree on native | N/A or new source |
| network      | Playwright request log | ❌ not exposed by Maestro CLI | drop or proxy |
| console      | browser console | ⚠️ device logs (different) | adapter |
| perf/webvitals | CDP web-vitals | ❌ no web vitals on native | drop or new metric |
| url          | URL trajectory | ❌ no URLs; screens instead | redefine as screen trajectory |
| design       | CSS design tokens | ❌ N/A | drop |

**Conclusion:** ~2 of 9 verify layers (visual, partially text) map directly;
the rest are browser-specific and would either be dropped for mobile projects or
require a native-equivalent source. The clean design is to make the verify
layers **capability-gated** (a Maestro run reports only the layers it can
produce), which the check-modes system (`enforce/log/disable` per layer) is
already structured to support.

## 6. Streaming + manual editing ⚠️ (built; architecture right, quality poor)

Full detail in **[STREAMING.md](./STREAMING.md)**.

**Architecturally it fits, and it's built.** `ios-bridge` (the ticket's link) is
**simulator-focused** (not real-device as I first assumed) and is essentially a
wrapper around **idb** — whose frame format is the same shape as Lastest's
`stream:frame` (base64 JPEG in JSON) and whose `idb ui tap` maps onto
`stream:input`. So we used idb directly and needed **no new viewer or protocol**:

- The runner streams via `idb video-stream` → ffmpeg → `stream:frame`.
- Frames traverse Lastest's authenticated `/api/embedded/stream` proxy.
- `/mobile` renders them in the **real `BrowserViewer` component**, interactive.

**But the stream is not production-usable**, due to an external constraint:
`idb-companion` **1.1.8 is the newest release (Aug 2022)** and (a) its `mjpeg`
encoder returns 0 bytes and (b) it **ignores `--scale-factor`**. So ffmpeg must
decode full-res H.264 at ~0.6× realtime, falls behind, and the view lags. Input
is also slow because each tap spawns a fresh `idb ui tap` process.

Concrete paths to fix (none attempted — out of PoC scope): build idb-companion
from source (~4 years of unreleased fixes), switch to screenshot polling (~7 fps
but immune to lag/tearing), and hold a persistent idb session for input.

**Manual editing / recording** layers on the same input path, or use
`maestro studio` in the interim.

Net: **streaming is feasible and wired end-to-end, but making it feel good is
real work** — a distinct phase-2 workstream after the run pipeline.

---

## Recommendation

1. **Run-only Maestro integration is low-risk and mostly additive.** A real
   `maestro-runner` package + a `"maestro"` capability + `requiredCapabilities`
   tagging gets Maestro tests running through the existing protocol and build
   pipeline with small, localized host changes.
2. **The verify model is the real design decision.** Make verify layers
   capability-gated so mobile runs report visual (+ maybe text) and cleanly omit
   the browser-only layers, rather than trying to fake DOM/a11y/network on native.
3. **Decouple the local/manual runner path from the k8s provisioner** (the
   `none`-provisioner path already exists; make sure registration never assumes
   a pod).
4. **Streaming is feasible** (see STREAMING.md) — ios-bridge's frame/input model
   already matches Lastest's `stream:frame`/`stream:input`. Do it via `idb`
   directly in the runner. Still phase 2; use `maestro studio` for authoring
   in the interim.

Net: **Lastest can include mobile testing without a fundamental rewrite of the
protocol or dispatch.** The scope is a new runner package + capability-gated
verify, with streaming/recording as a clearly separable phase 2.
