# macOS app testing via Appium mac2driver — findings

**Question:** Maestro can't drive macOS apps. Can Appium's
[mac2driver](https://github.com/appium/appium-mac2-driver)? Local confirmation only.

**Answer: yes.** Session attach, AX tree, element resolution, clicking and
window-scoped screenshots all work against a real App Store app. Full loop
(resolve → click → assert) proven in `probes/03-interact.mjs`.

**Scope:** the ticket said "iOS apps from the App Store"; confirmed during the
spike that a **native macOS app is acceptable** — iOS apps behave as macOS apps on
Apple Silicon. Target: WhatsApp 26.30.77 (`net.whatsapp.WhatsApp`), driven logged
out.

**Evidence base:** all findings rest on a single app — indicative, not general.

---

## 1. It works ✅

| | |
|---|---|
| Session attach by `bundleId` | ✅ ~3.5s incl. WebDriverAgentMac startup |
| AX tree (`GET /session/:id/source`) | ✅ 58 KB XML, 269 elements |
| Click | ✅ drove a real UI transition |
| Window-scoped screenshot | ✅ 67 KB, 960×1049 |
| Full-screen screenshot | ⚠️ works, unusable — §2 |

Appium is **automation, not a testing framework** — no assertions, no runner, no
verdicts. mac2driver is a thin proxy over **WebDriverAgentMac**, an XCUITest
target it builds and launches via `xcodebuild`. That's where the real automation
happens, and why §6’s limits are Apple's rather than Appium's.

Convenient for us: Lastest already *is* the test framework. It needs an engine to
drive the UI and hand back a screenshot + tree, which is exactly what this is.

## 2. `/session/:id/screenshot` is SCREEN-scoped ⚠️

It captures the **entire display** — wallpaper, other windows, menu-bar clock. 3.3 MB
and **non-deterministic**: the clock alone changes every minute, so every baseline
would diff.

Use an *element*-scoped screenshot of the window instead:

```js
const win = await find("**/XCUIElementTypeWindow", "class chain");
GET /session/:id/element/{win}/screenshot   // → 67 KB, window only, deterministic
```

This is the only viable baseline source for the visual layer (`proof/02-window.png`).
Using the session endpoint appears to work, then produces permanently-failing diffs.

## 3. Selector surface is thin ⚠️

App window only, excluding ~212 AppKit menu-bar items:

| | count |
|---|---|
| has `identifier` (AX id) | 4 |
| `label` only | 6 |
| `title` only | 1 |
| **nothing addressable** | **16** |

Of those 4 identifiers, 3 are window chrome (`_XCUI:CloseWindow`, …) and one is
`SceneWindow`. **Zero app-authored test IDs.** Everything addressable comes from
`label` — i.e. user-visible text, which is locale-dependent and changes with copy
edits.

> **For recording:** durable selectors for *labelled* controls, coordinates for the
> other ~59%. Coordinate steps are fragile across window sizes and OS versions.
> Fine for apps we control; risky for third-party App Store apps, which we can't
> expect to set `accessibilityIdentifier`.

## 4. macOS modals overlay the tree ⚠️

A browser navigation replaces the DOM. A macOS modal doesn't — it renders *over*
the existing tree, and the underlying content stays.

Clicking `Continue` opened WhatsApp's login sheet. The naive assertion
("`Welcome to WhatsApp` should be gone") **failed on a click that worked**. Assert
on what the dialog *added*:

```js
const appeared = after.filter(l => !before.includes(l));   // ["Close", "Log into WhatsApp", …]
```

Native step assertions must diff added AX content or scope to the frontmost
dialog. Getting this wrong yields false failures on every modal interaction.

## 5. Mapping to Lastest's 9 check layers

**4 of 9 usable (2 cleanly).** Same capability-gating conclusion as the Maestro
PoC, now with a second data point.

| Layer | | Notes |
|---|---|---|
| `visual` | ✅ | via window-scoped element screenshot (§2) |
| `text` | ✅ | from AX labels |
| `dom` | ⚠️ | real hierarchy, but thin and mostly unaddressable (§3) |
| `a11y` | ⚠️ | XCUITest *is* the accessibility API, but WCAG rules are web-shaped |
| `network` | ❌ | no CDP; would need a proxy |
| `console` | ❌ | no equivalent |
| `perf` | ❌ | native metrics are a different model |
| `url` | ❌ | no URLs — meaningless for native |
| `design` | ❌ | token engine reads computed CSS |

## 6. API gaps

- `POST /appium/device/activate_app` → **405**. Launch via the `appium:bundleId`
  capability at session creation.
- No `visible` attribute. Valid: `elementType`, `enabled`, `focused`, `frame`,
  `hittable`, `identifier`, `label`, `placeholderValue`, `selected`, `title`,
  `value`. Use **`hittable`** for actionability.

## 7. Not proven

- **Runner integration.** The Maestro PoC already showed the host↔runner contract
  is engine-agnostic (host never parses the test `code`); mac2 doesn't change that.
  An `appium-mac2-runner` would be `maestro-app-runner` with the executor swapped.
- **Authenticated flows.** Stops at the login sheet; never authenticates.
- **CI / headless.** mac2driver needs a real logged-in macOS GUI session and
  Accessibility permission — it can't containerise. Hosted would need dedicated
  Mac hardware. **This is the main blocker between the spike and a shippable
  feature.**
- **Live streaming.** Phase 2, same as the Maestro PoC.

## 8. Security notes

**Supply chain.** Installed during the ChainDrop npm worm window with
`ignore-scripts=true`, `before=2026-08-04T00:00:00Z`, `save-exact=true` and
`--frozen-lockfile`. All **617** resolved packages (318 app + 299 driver tree)
audited against npm publish timestamps — **zero** on or after 2026-08-04.
`appium-mac2-driver@4.1.0` was published inside the window (2026-08-07) and is
deliberately not used; this pins **4.0.5**.

**No committed credentials.** Two captures were taken and deleted: the full-screen
shot (§2, contained desktop and other windows), and the post-click capture
(contained a **live WhatsApp QR login code** — scanning it links a real device to
an account). `probes/03-interact.mjs` therefore asserts that step via the AX tree
and takes no screenshot. The committed screenshots are the **logged-out** welcome
screen; `proof/01-source.xml` is trimmed to the app window, dropping a menu item
carrying the local account name.
