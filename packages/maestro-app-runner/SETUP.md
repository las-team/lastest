# Mobile PoC — local setup (#197)

Run a Maestro test on an iOS simulator through Lastest's existing EB protocol,
and see the sim stream live in the Lastest UI. Throwaway spike, macOS only.

## Requirements

**macOS + Xcode** (iOS sims are macOS-only). Install these and put them on `PATH`
(versions are minimums):

| Dependency | Min | For |
|---|---|---|
| Xcode + iOS Simulator runtime | Xcode 16 / iOS 17 | the simulator + `simctl` |
| Java (JDK) | **17+** | Maestro is a JVM app |
| Node.js | **20+** | host + runner |
| Maestro | 2.x | runs the tests |
| idb (`fb-idb`) + idb-companion | 1.1.x | stream + input |
| ffmpeg | 6+ | H.264 → JPEG frames |
| PostgreSQL | 14+ | Lastest DB (`docker compose up -d`) |

> If `brew install facebook/fb/idb-companion` fails on an Xcode-version check,
> extract its prebuilt bottle into `~/.idb-companion/` and add it to `PATH` —
> the binary runs fine on Xcode 16.

## Run

Only **two** terminals stay occupied (the host and the runner); everything else
returns immediately. All commands run from the repo root.

### Terminal 1 — setup (all of these return / run in the background)

```bash
# Boot a simulator and grab its UDID (the companion needs it explicitly).
xcrun simctl boot "iPhone 16"
UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)

# The idb companion powers streaming + input. Start it explicitly —
# idb's auto-spawn is unreliable.
idb_companion --udid "$UDID" --grpc-port 10882 &
idb connect localhost 10882

# Database.
docker compose up -d
```

### Terminal 2 — the Lastest host (stays running)

`EB_PROVISIONER=none` because this runner is a local process, not a k8s pod —
otherwise `auto-register` tries to `kubectl` a pod that doesn't exist and 500s.

```bash
EB_PROVISIONER=none EB_DEV_PORT_FORWARD=0 pnpm dev        # wait for :3000
```

### Terminal 3 — the runner (stays running)

Auto-detects the booted simulator, so no UDID needed here. Prints
`[register] ok runner=<id>` — copy that id for the next step.

```bash
env SYSTEM_EB_TOKEN="$(grep SYSTEM_EB_TOKEN .env | cut -d= -f2)" \
    LASTEST_URL=http://localhost:3000 RUNNER_MODE=real MAESTRO_STREAM=1 \
    MAESTRO_APP_ID=com.apple.Preferences \
    node --experimental-strip-types packages/maestro-app-runner/src/index.ts
```

### Back in terminal 1 — dispatch a test

The `code` payload is **Maestro YAML**, not Playwright JS — that's the point.

```bash
DATABASE_URL="$(grep DATABASE_URL .env | cut -d= -f2-)" \
    node packages/maestro-app-runner/scripts/dispatch-run-test.mjs \
    <runner-id> packages/maestro-app-runner/flows/ios-settings.yaml
```

The runner runs `maestro test` on the sim (a short navigation of the iOS Settings
app) and reports `status=passed` + step screenshots back to the host.

### See the live stream — in the Lastest UI

Sign in and open **`http://localhost:3000/mobile`**. The simulator renders in
Lastest's own `BrowserViewer` component (the same one the browser EB uses),
fed through the host's authenticated `/api/embedded/stream` proxy. Clicking the
canvas taps the simulator.

Open this page *before* dispatching the test, then run the dispatch command to
watch the flow drive the device live.

> **Expect lag.** The stream is functional but not smooth — see "Scope & known
> limitations". A standalone `viewer.html` also ships in this package if you want
> to see the frames without signing in (it connects straight to the runner).

## Key env vars

`SYSTEM_EB_TOKEN` (required, must match host `.env`) · `LASTEST_URL` ·
`RUNNER_MODE` (`fake`|`real`) · `MAESTRO_STREAM` (`1`) · `MAESTRO_APP_ID` ·
`MAESTRO_UDID` (auto-detected if unset). Device dimensions are auto-detected.

Uses the built-in Settings app to skip building the RN app; to test the bundled
`packages/maestro-poc-app` instead, see this package's `README.md`. Design
details: `FINDINGS.md`, `STREAMING.md`.

## Scope & known limitations (read before judging)

This is a **PoC that proves the plumbing**, not a finished feature. What it does
and does not show:

- **The sample drives Apple's Settings app, not a real app under test.** The
  bundled RN app (`packages/maestro-poc-app`) was the intended target, but it
  does not build on this Xcode toolchain (Swift 6.2 / Boost — see `FINDINGS.md`).
  Settings is a stand-in that proves Maestro → runner → host works end to end;
  it does **not** exercise custom `testID` selectors or app-specific flows.
- **The flow is hardened for a fresh simulator** — it dismisses first-run popups
  (optional taps) and waits for each screen, so it passes on a just-erased sim.
  If you still see a flake, erase the sim (`xcrun simctl erase <udid>`) and retry.
- **Streaming works but lags — this is the weakest part of the PoC.** The cause
  is external: `idb-companion` 1.1.8 (the newest release, from Aug 2022) has a
  broken `mjpeg` encoder and **ignores `--scale-factor`**, so ffmpeg must decode
  full-resolution H.264 at ~0.6× realtime and falls progressively behind. The
  view therefore trails reality and can appear to stick on a frame. Lowering
  `STREAM_FPS` slows the drift but can't fix it. Clicks are also slow (~0.5s):
  each tap spawns a fresh `idb ui tap` process. `STREAMING.md` lists the three
  concrete paths to a good stream (build idb from source / screenshot polling /
  persistent idb session) — none were attempted, as this is out of PoC scope.
- **What streaming DOES prove:** the frames travel simulator → runner → Lastest's
  authenticated host proxy → Lastest's real viewer component, and taps travel
  back. The architecture is right; the frame source needs work.
