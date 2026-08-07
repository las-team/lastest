# Setup

Throwaway spike — see `FINDINGS.md`. Deliberately **not** a workspace member: it
installs an isolated tree so Appium's ~600 packages never mix into the repo lockfile.

**Needs:** macOS with Xcode, Node ≥ 18, and Accessibility permission (the first
session prompts; macOS shows "Automation Running" for its duration).

## Install

```bash
cd packages/appium-mac2-poc
pnpm install --ignore-workspace --ignore-scripts --frozen-lockfile
APPIUM_HOME="$PWD/.appium" pnpm exec appium driver install --source=npm "appium-mac2-driver@4.0.5"
```

`--frozen-lockfile` uses the committed lockfile exactly, so you get the audited
versions instead of re-resolving. Don't relax the `.npmrc` pins or regenerate the
lockfile without re-running the timestamp audit — `FINDINGS.md` §8. 4.1.0 is
inside the ChainDrop window; the pin is deliberate.

## Run

```bash
pnpm serve      # terminal 1, leave running
pnpm probe      # terminal 2 — the headline: resolve → click → assert
```

`pnpm probe` is enough to confirm it works. The others each prove a specific
finding; `pnpm probe:all` runs all three.

| | proves |
|---|---|
| `01-session.mjs` | attach, AX tree, screen-scope problem (§1, §2) |
| `02-window-and-selectors.mjs` | window capture, thin selector surface (§2, §3) |
| `03-interact.mjs` | full loop (§1, §4) |

Override the target with `AUT_BUNDLE_ID=com.apple.calculator`.

## Gotchas

- **Kill stale processes between runs.** A crashed run leaves the server on :4723
  *plus* `WebDriverAgentRunner` + `xcodebuild` holding the automation session
  (that's what keeps "Automation Running" up). Killing only the server leaves the
  port held:
  ```bash
  pkill -f "appium --port 4723"; pkill -f WebDriverAgentRunner; pkill -f "xcodebuild.*WebDriverAgentMac"
  ```
- First session takes ~30-60s while Xcode builds WebDriverAgentMac; later ones ~3.5s.
- `appium:systemPort` must differ between concurrent sessions.
- **Never commit a full-screen screenshot** — it captures your desktop. Use the
  window-scoped element endpoint (§2).
