# maestro-app-runner (PoC — issue #197)

A **throwaway spike** proving Lastest's *embedded-browser protocol* can accept a
non-Playwright runner. Instead of launching Chromium via Playwright, this runner
shells out to **Maestro** and drives a local iOS simulator (or Android emulator).

It is deliberately minimal and **not merge-quality**. It exists to answer one
question: _does the existing host↔runner contract accept a mobile test engine
with no host changes?_ See [FINDINGS.md](./FINDINGS.md) for the answer.

## What it does

1. Registers with the host via `POST /api/embedded/auto-register` (the same
   endpoint the real system EB uses), authenticating with `SYSTEM_EB_TOKEN`.
2. Long-polls `POST /api/ws/runner` (`status:heartbeat`) for commands.
3. On `command:run_test`, treats the dispatched `code` payload as **Maestro
   YAML** (not Playwright JS), runs `maestro test`, and maps the screenshots +
   exit code back into `response:screenshot` + `response:test_result`.

Two modes via `RUNNER_MODE`:

- `fake` (default) — replies with a canned pass + synthetic screenshot. Proves
  the host accepts a non-Playwright runner end-to-end without driving a device.
- `real` — actually runs `maestro test` against the booted simulator.

## Prerequisites (this machine)

Maestro needs JDK 17+, and Node/Expo need Node ≥20. The login shell has neither
first on PATH, so source the pinned env recipe:

```bash
source packages/maestro-app-runner/.poc-env.sh   # JDK17 + Node24 + Maestro on PATH
```

- **Maestro 2.8.0** — installed at `~/.maestro/bin` (the Homebrew formula was
  blocked by an unrelated Xcode-version gate; used the official installer).
- **openjdk@17** — keg-only brew formula; `.poc-env.sh` sets `JAVA_HOME`.
- **iOS sim app** — `packages/maestro-poc-app` (Expo RN), bundle id
  `com.anonymous.maestro-poc-app`, built + installed on a booted iPhone 16 sim.

## Run the end-to-end PoC

```bash
# 1. Host (separate terminal). Two overrides matter:
#    - :3000 was taken by another app here, so use 3100.
#    - EB_PROVISIONER=none / EB_DEV_PORT_FORWARD=0: a manually-launched,
#      non-containerized runner must NOT route through the k8s EB provisioner,
#      which otherwise 500s auto-register trying to kubectl a non-existent pod.
source packages/maestro-app-runner/.poc-env.sh
EB_PROVISIONER=none EB_DEV_PORT_FORWARD=0 PORT=3100 \
  NODE_OPTIONS='--require ./scripts/ws-proxy-preload.js' \
  node_modules/.bin/next dev -p 3100

# 2. Boot sim + install the RN app (once):
xcrun simctl boot "iPhone 16"
cd packages/maestro-poc-app && npx expo run:ios --device "iPhone 16"

# 3. The runner (real mode). Note bundle id = com.lastest.maestropoc (app.json):
source packages/maestro-app-runner/.poc-env.sh
env \
  SYSTEM_EB_TOKEN="$(grep SYSTEM_EB_TOKEN .env | cut -d= -f2)" \
  LASTEST_URL=http://localhost:3100 \
  RUNNER_MODE=real \
  MAESTRO_PLATFORM=ios \
  MAESTRO_APP_ID=com.lastest.maestropoc \
  node --experimental-strip-types packages/maestro-app-runner/src/index.ts

# 4. Dispatch a run_test carrying the Maestro YAML as its `code` payload.
#    Grab the runnerId the runner logged, then:
DATABASE_URL="$(grep DATABASE_URL .env | cut -d= -f2-)" \
  node packages/maestro-app-runner/scripts/dispatch-run-test.mjs <runnerId>
```

The runner registers as a system EB and long-polls. Step 4 enqueues a
`command:run_test` whose `code` is `flows/counter.yaml`; the runner runs
`maestro test` and reports the result + step screenshots back to the host.

## Files

- `src/index.ts` — the runner (EB protocol client + Maestro integration).
- `flows/counter.yaml` — a Maestro flow for the PoC RN app's counter screen.
- `scripts/dispatch-run-test.mjs` — enqueues a run_test for a given runnerId.
- `.poc-env.sh` — env recipe (JDK17 + Node24 + Maestro).
