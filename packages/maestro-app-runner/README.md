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
4. With `MAESTRO_STREAM=1`, serves the booted simulator's screen live to
   Lastest's existing viewer (see [STREAMING.md](./STREAMING.md)).

Two modes via `RUNNER_MODE`:

- `fake` (default) — replies with a canned pass + synthetic screenshot. Proves
  the host accepts a non-Playwright runner end-to-end without driving a device.
- `real` — actually runs `maestro test` against the booted simulator.

## Setup & running

**See [SETUP.md](./SETUP.md)** for the dependency list (with minimum versions)
and the end-to-end reproduction steps. In short: install the required tools, boot
an iOS simulator, start the host with `EB_PROVISIONER=none`, start the runner,
and dispatch a `run_test` whose `code` is a Maestro flow. The runner
auto-detects the booted simulator, so no UDID needs to be set.

### Testing the bundled RN app

The default flow drives the built-in iOS Settings app to skip a native build. To
test the sibling Expo app (`packages/maestro-poc-app`, bundle id
`com.lastest.maestropoc`) instead, build it with `expo run:ios` and point
`MAESTRO_APP_ID` at it.

## Files

- `src/index.ts` — the runner (EB protocol client + Maestro integration + sim
  auto-detection).
- `src/stream.ts` — live simulator streaming (idb → ffmpeg → `stream:frame`).
- `flows/` — Maestro flows (`ios-settings.yaml`, `counter.yaml`).
- `scripts/dispatch-run-test.mjs` — enqueues a `run_test` for a given runnerId.
- `viewer.html` — standalone stream viewer (renders frames + click-to-tap), no
  Lastest login needed.
- `SETUP.md` — reviewer setup & reproduction guide.
- `FINDINGS.md` / `STREAMING.md` — protocol + streaming write-ups.
