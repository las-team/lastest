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

## Run (each block in its own terminal, from repo root)

```bash
# 1. Boot a simulator, capture its UDID
xcrun simctl boot "iPhone 16"
UDID=$(xcrun simctl list devices booted -j | \
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const r in j.devices)for(const d of j.devices[r])if(d.state==="Booted"){console.log(d.udid);break}})')

# 2. Start the idb companion for that sim (required for streaming + input;
#    idb's auto-spawn is unreliable, so start it explicitly).
idb_companion --udid "$UDID" --grpc-port 10882 &
idb connect localhost 10882

# 3. DB + host (EB_PROVISIONER=none: the runner isn't a k8s pod)
docker compose up -d
EB_PROVISIONER=none EB_DEV_PORT_FORWARD=0 pnpm dev        # wait for :3000

# 4. Runner (real mode + streaming). Auto-detects the booted sim.
#    Prints `[register] ok runner=<id>` — copy the id.
env SYSTEM_EB_TOKEN="$(grep SYSTEM_EB_TOKEN .env | cut -d= -f2)" \
    LASTEST_URL=http://localhost:3000 RUNNER_MODE=real MAESTRO_STREAM=1 \
    MAESTRO_APP_ID=com.apple.Preferences \
    node --experimental-strip-types packages/maestro-app-runner/src/index.ts

# 5. Dispatch a test (Maestro YAML as the run_test `code` payload)
DATABASE_URL="$(grep DATABASE_URL .env | cut -d= -f2-)" \
    node packages/maestro-app-runner/scripts/dispatch-run-test.mjs \
    <runner-id> packages/maestro-app-runner/flows/ios-settings.yaml
```

The runner runs `maestro test` on the sim and reports `status=passed` + step
screenshots back to the host.

### See the live stream

Open **`packages/maestro-app-runner/viewer.html`** in a browser (it defaults to
`ws://localhost:9223`, the runner's stream port). It renders the live simulator
onto a canvas, and **clicking the canvas taps the sim** (`stream:input` →
`idb ui tap`). This is a standalone viewer — no Lastest login needed. Run the
test in step 5 while it's open to watch the flow drive the device live.

> The same frames also flow into Lastest's built-in viewer via the host's
> `/api/embedded/stream` proxy when signed in; the standalone page just skips the
> login + session plumbing. See `STREAMING.md`.

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
- **Streaming is unoptimized** — frames are H.264→JPEG with no forced keyframes,
  so **expect visible tearing during fast screen transitions**. It is smoother
  when you watch on your own machine than through any screen-share/recording. The
  deliberate `waitForAnimationToEnd` pacing in the flow reduces it.
- **Viewer→sim input** works through the standalone `viewer.html`
  (`stream:input` → `idb ui tap`); routing that same input through Lastest's host
  proxy is not yet wired (frames flow, input doesn't) — see `STREAMING.md`.
