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
# 1. Boot a simulator
xcrun simctl boot "iPhone 16"

# 2. DB + host (EB_PROVISIONER=none: the runner isn't a k8s pod)
docker compose up -d
EB_PROVISIONER=none EB_DEV_PORT_FORWARD=0 pnpm dev        # wait for :3000

# 3. Runner (real mode + streaming). Auto-detects the booted sim.
#    Prints `[register] ok runner=<id>` — copy the id.
env SYSTEM_EB_TOKEN="$(grep SYSTEM_EB_TOKEN .env | cut -d= -f2)" \
    LASTEST_URL=http://localhost:3000 RUNNER_MODE=real MAESTRO_STREAM=1 \
    MAESTRO_APP_ID=com.apple.Preferences \
    node --experimental-strip-types packages/maestro-app-runner/src/index.ts

# 4. Dispatch a test (Maestro YAML as the run_test `code` payload)
DATABASE_URL="$(grep DATABASE_URL .env | cut -d= -f2-)" \
    node packages/maestro-app-runner/scripts/dispatch-run-test.mjs \
    <runner-id> packages/maestro-app-runner/flows/ios-settings.yaml
```

The runner runs `maestro test` on the sim and reports `status=passed` + step
screenshots to the host. Open `http://localhost:3000`, sign in, and the sim
streams into Lastest's existing viewer.

## Key env vars

`SYSTEM_EB_TOKEN` (required, must match host `.env`) · `LASTEST_URL` ·
`RUNNER_MODE` (`fake`|`real`) · `MAESTRO_STREAM` (`1`) · `MAESTRO_APP_ID` ·
`MAESTRO_UDID` (auto-detected if unset). Device dimensions are auto-detected.

Uses the built-in Settings app to skip building the RN app; to test the bundled
`packages/maestro-poc-app` instead, see this package's `README.md`. Design
details: `FINDINGS.md`, `STREAMING.md`.
