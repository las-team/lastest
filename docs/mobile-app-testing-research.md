# Mobile App Testing: Feasibility & Approach for lasTest

Research document — May 2026. How to extend lasTest (Next.js + Postgres + Playwright + k3d-provisioned "embedded browser" pods) to cover Android and iOS apps, including from the App Store / Play Store and manually-uploaded builds.

## TL;DR

- **Android in our cluster is realistic.** Run AOSP emulators inside k8s pods using KVM (`/dev/kvm` device plugin + privileged-ish pods on x86 nodes with nested virtualization). The reference image is `budtmo/docker-android`; it ships a Helm chart and runs headless with noVNC/scrcpy for the live stream. This mirrors our existing EB pod architecture almost 1:1.
- **iOS in our cluster is not realistic.** Apple's license forbids running iOS/macOS on non-Apple hardware. Two viable paths:
  1. **Corellium** — the only legal non-Apple-hardware virtual iOS (ARM, used by security researchers, REST API, $$$); now owned by Cellebrite as of 2025.
  2. **Hybrid: outsource iOS to a cloud device farm** (BrowserStack App Automate, Sauce Labs RDC, LambdaTest) or to a dedicated mac-mini pool driven via MacStadium Orka (Kubernetes-on-macOS). Cheapest pragmatic answer for MVP.
- **The interaction model has converged on the accessibility tree, not raw pixels.** Maestro (mobile.dev) is the clear 2024-2026 winner for the developer-facing API: declarative YAML flows, reads the accessibility tree the same way VoiceOver/TalkBack does, has a Studio recorder that converts taps/swipes into YAML in real time. Appium 2.x/3.x is still the workhorse for enterprises; Detox owns React Native.
- **AI testing for mobile is already real.** Vision-language-model agents (Claude, GPT-4o, Gemini) drive emulators via screenshots + tap coords; accessibility-tree agents are cheaper and more reliable. Anthropic has "Claude Orbit" in research preview (phone agent that taps/types like a human). MobAI offers AI-native mobile automation through Claude Code/MCP. This is a strong fit for our existing AI-failure-triage architecture.
- **Recommended MVP (≈3–4 weeks of focused work):**
  1. Add an `EB_PROVISIONER=android-emulator` mode that provisions a `budtmo/docker-android`-based pod ("Embedded Android" / EA) into the same k3d cluster used by EB.
  2. Reuse the existing EB WebSocket protocol for screenshot streaming + interaction injection; swap `click(x,y)` for `tap(x,y)` and `selector` for `accessibility-id`.
  3. Capture flows by recording taps + accessibility-tree hits (the Maestro model), persist as a `mobile_test_flow` table that mirrors our existing test/step schema.
  4. Visual diffing reuses `src/lib/diff/` unchanged — a PNG is a PNG.
  5. Defer iOS: stub a "remote runner" backend that talks to BrowserStack App Automate via Appium-WebDriver, so iOS tests are billed pay-per-minute until we decide it's worth more.

---

## 1. Emulator & simulator infrastructure

### Android

Running Android in a container is a solved problem.

| Option | What it is | Fit for us |
| --- | --- | --- |
| **[`budtmo/docker-android`](https://github.com/budtmo/docker-android)** | Docker image bundling Android emulator, ADB, noVNC, Appium, video recording. Ships a Helm chart. | **Best starting point.** Active in 2026, Kubernetes-ready, x86 + ARM image variants. |
| **[`google/android-emulator-container-scripts`](https://github.com/google/android-emulator-container-scripts)** | Google's reference for emulator-in-Docker, exposes gRPC + ADB. | Cleaner base if we want to build our own image. Less batteries-included than budtmo. |
| **Genymotion Cloud SaaS** | Hosted Android emulators (AWS/GCP backed), REST API. | Buy-not-build path; reasonable cost; no infra burden. |
| **AWS Device Farm / Firebase Test Lab** | Real-device farms, pay per minute, Appium/Espresso compatible. | Good for breadth; weak for interactive recording. |

**KVM is the lever.** Without `/dev/kvm` an emulator runs on swiftshader at ~3-5 fps. With KVM it's near-native. Requirements:

- **x86 host with VT-x/AMD-V exposed** *and* nested virtualization enabled if the host is itself a VM.
- A KVM device plugin for k8s (community plugins exist; some k3d setups can mount `/dev/kvm` directly via host path).
- **Privileged or `SYS_PTRACE` + device cgroups** on the pod (mirrors the EB pod's elevated profile).
- ARM emulators on ARM hosts (Graviton, Ampere Altra, Apple Silicon Macs) are dramatically faster — but **Graviton 2/3 do not support nested virtualization** ([AWS re:Post](https://repost.aws/questions/QUEoabj2ZERq2P5QFL6d6-RQ/nested-virtualization-on-graviton)), and AWS only offers nested virt on bare-metal x86 (e.g. `c5n.metal`) or on EC2 mac instances. GKE supports nested virt on x86 Standard node pools ([GKE docs](https://cloud.google.com/kubernetes-engine/docs/how-to/nested-virtualization)).
- Local dev (k3d → Docker → Linux host with `/dev/kvm`) is the easiest case: just mount `/dev/kvm` into the pod via a `hostPath` volume. We're already privileged-ish for EB.

A reasonable Android pod spec is ~2 vCPU / 4 GiB RAM / 6 GiB ephemeral storage + KVM. We can run multiple per node — pricing-wise it's much cheaper than what cloud device farms charge per minute.

### iOS

This is the hard problem. Apple's macOS EULA forbids running iOS or macOS on non-Apple hardware. Three paths:

1. **[Corellium](https://www.corellium.com/)** — proprietary ARM hypervisor that virtualizes iOS on non-Apple hardware. Legal precedent went their way after Apple sued (settled). Used by Cellebrite, government, security researchers. REST + WebSocket API, [`corellium-api`](https://github.com/corellium/corellium-api) for Node, supports iOS 26 as of release 7.7 (Nov 2025). **Pricing is opaque and usage-based** ("core-hour" model); Enterprise tier is typically $$$ per seat. Acquired by Cellebrite for $170M in 2025 — be aware of the brand/PR angle if we resell.
2. **Apple-hardware Mac pool driven by Kubernetes via [MacStadium Orka](https://macstadium.com/orka)** — ephemeral macOS VMs on bare-metal Mac minis or M2 Ultras. K8s-native, CNCF-certified, runs Xcode + iOS Simulator. Lloyds Bank reports 90→25 min build times. Either hosted at MacStadium, on EC2 Mac instances, or on-prem. Best fit if we want first-party iOS infra. Roughly $200–500 / mac / month managed.
3. **Outsource entirely to BrowserStack App Automate or Sauce Labs Real Device Cloud.** Pay-per-minute on real iPhones, Appium-compatible. Our backend becomes "remote runner talks to Appium over the network." This is what most companies do.

[Tart](https://github.com/cirruslabs/tart) and [Cilicon](https://github.com/traderepublic/Cilicon) virtualize macOS on Apple Silicon Macs using Apple's Virtualization framework — useful building blocks if we build our own Mac pool, but they still require Mac hardware.

### Cloud device farms (the "buy" option) — 2026 pricing

From [BrowserStack vs Sauce Labs comparisons](https://www.drizz.dev/post/top-browserstack-alternatives-in-2026):

| Provider | Entry plan | Real-device cloud | Enterprise avg |
| --- | --- | --- | --- |
| BrowserStack | $29/mo Live, $129/mo Automate | 2,000+ iOS, 2,500+ Android | $43.5k/yr |
| Sauce Labs | $49/mo, RDC from $199/mo | ~20k devices | $101k/yr |
| LambdaTest / TestMu | $15/mo Live, $99/mo Automate | Smaller pool | $25k/yr (≈50% of BrowserStack) |
| AWS Device Farm | $0.17/device-minute | Pay-as-you-go | n/a |
| Firebase Test Lab | Free tier + per-minute | Google devices | n/a |

For a partial-coverage MVP, **LambdaTest or AWS Device Farm via Appium is the lowest-friction iOS path.**

---

## 2. Capturing point-and-click interactions on mobile

Our EB pods record Playwright `click(selector | x,y)` events on web pages. The mobile equivalents:

### Android primitives

- **ADB** — `adb shell input tap X Y`, `adb shell input swipe`. The "raw pixels" channel.
- **UIAutomator2 / Espresso** — semantic locators (`resource-id`, `content-desc`, text). Espresso requires app instrumentation; UIAutomator2 doesn't.
- **Accessibility-tree dump** — `adb shell uiautomator dump`. This is the same tree TalkBack reads. Mobile equivalent of the DOM/AX tree.
- **Screen streaming** — [`scrcpy`](https://github.com/Genymobile/scrcpy) for low-latency live mirroring, or `adb shell screenrecord` for capture. Both pipe into our existing WebSocket frame protocol with minor adaptation.

### iOS primitives

- **[WebDriverAgent](https://github.com/appium/WebDriverAgent)** — XCTest-backed HTTP server, runs on simulator or real device. The protocol Appium speaks. ([Appium XCUITest driver docs](https://appium.github.io/appium-xcuitest-driver/))
- **XCUITest** — Apple's official UI testing framework. Required to be co-signed with the app.
- **`idb` (Facebook)** and **`tidevice`** — CLI tools for real device control without going through Xcode.
- **Accessibility Inspector** — Apple's UI hierarchy explorer; same data exposed via XCUITest.

### Cross-platform layers

- **[Appium 2.x / 3.x](https://appium.io/)** — the WebDriver-for-mobile standard. Driver-based architecture: install only the drivers you need (uiautomator2, xcuitest). Battle-tested but heavy. **Note:** XCUITest driver 10+ now requires Appium 3.
- **[Maestro (mobile.dev)](https://github.com/mobile-dev-inc/Maestro)** — declarative YAML flows, accessibility-tree based, "[Maestro Studio](https://docs.maestro.dev/getting-started/writing-your-first-flow)" recorder converts user taps into YAML in real time. Maestro Cloud for hosted runs, BrowserStack integration in beta. **This is the closest thing to "Playwright for mobile" — and the closest API match for our existing recorder UX.**
- **[Detox](https://github.com/wix/Detox)** — Wix's React Native E2E framework. Use this if/when we add RN-specific features.

The 2025–2026 industry direction is clear: **record against the accessibility tree, not pixel coordinates.** Pixel coords break across screen sizes; accessibility IDs survive. This matches the way our web recorder prefers `getByRole` over absolute selectors.

---

## 3. Competitor landscape (2025–2026)

### Mobile-native test platforms

- **[Maestro / mobile.dev](https://maestro.dev/)** — fastest growing. YAML, accessibility-tree, Studio recorder, Cloud. Recent Wahed case study cut test creation time by 95% (3–4 hours → 10–15 min). Strongest "OSS + paid cloud" model in the space.
- **Appium 2.x/3.x** — incumbent. Largest cloud-device-farm ecosystem.
- **Detox** — React Native.
- **Espresso / XCUITest** — Google's and Apple's first-party frameworks; required if you want full instrumentation access.

### Cloud farms

BrowserStack, Sauce Labs, LambdaTest/TestMu, AWS Device Farm, Firebase Test Lab, HeadSpin, Kobiton, pCloudy.

### AI-driven mobile testing startups

- **[MobAI](https://mobai.run/)** — "AI-native mobile automation." Compact accessibility-tree snapshots, MCP-compatible (works with Claude Code, Cursor). Built specifically for agents.
- **Mobot** — human + AI mobile testers as a service (interesting model: real people on real devices, but orchestrated by AI).
- **Waldo** — record-and-replay with AI assertions.
- **QA Wolf** — managed AI test authoring.
- **Sofy, Testsigma, Functionize, Mabl, Reflect** — broader AI test platforms, mobile is one surface.

### Visual regression for mobile (directly competitive with our diff engine)

- **[Applitools](https://applitools.com/blog/visual-testing-for-mobile-apps/)** — Visual AI engine, "Ultrafast Grid" cross-device rendering, integrates with Appium / XCUITest / Espresso. Uses computer-vision-level semantic diffing, not pixel diff.
- **[BrowserStack App Percy](https://percy.io/blog/app-visual-testing)** — native+hybrid visual regression, baseline + diff workflow per device/OS combo, AI-assisted review.
- **[Panto AI](https://www.getpanto.ai/)**, Visual Regression Tracker (OSS) — newer / OSS alternatives.

**The big competitive gap we already have:** none of these are *open-source self-hosted with AI agent recording.* That's our positioning whether the target is web or mobile.

---

## 4. AI testing for mobile — state of 2026

Three patterns dominate:

1. **Pure-vision agents.** Screenshot → VLM (Claude 4.x, GPT-4o, Gemini) → predicted tap coordinates. Slow, expensive, but works on any app (incl. games, custom OpenGL UIs). Drizz research shows VLM-based Android testing has +9% code coverage vs traditional methods.
2. **Accessibility-tree agents.** Compact text representation of the screen → LLM → semantic action (`tap "Sign in" button`). Faster, cheaper, more robust. This is how Maestro Cloud's AI features and MobAI work.
3. **Hybrid.** Use a11y tree by default, fall back to vision for elements without accessibility metadata (canvas, OpenGL, game UIs).

Anthropic-specific developments:

- **[Claude Orbit](https://claudeorbit.com/)** — Anthropic's mobile-agent research preview. A "phone agent" that taps/types/navigates apps on iPhone or Android. Mobile-equivalent of computer use. Currently research preview, but it's the canonical reference point.
- **[Claude Code mobile-app-testing skill](https://mcpmarket.com/tools/skills/mobile-app-testing)** — a published skill for QA'ing mobile apps from Claude Code.
- **Christopher Meiklejohn's "Teaching Claude to QA a Mobile App" (March 2026)** — practical writeup of wiring Claude into an Android testing loop. Worth reading before we start implementing.

**Fit with our existing AI architecture.** We already have `src/lib/ai/` providers (claude-cli, openrouter, claude-agent-sdk, anthropic-direct, ollama) and a failure-triage pipeline (`failure-triage.ts`). The mobile path needs:

- A new "mobile-screen → action" prompt template that consumes either an accessibility-tree dump or a screenshot.
- Tool definitions for `tap`, `swipe`, `text-input`, `wait-for-element`, `read-accessibility-tree`.
- The same triage pipeline can ingest the mobile screenshot + a11y tree and explain failures the way it does for web today.

---

## 5. How this fits the k3d cluster

Our current dev architecture (from `CLAUDE.md`):
- Host Next.js (`pnpm dev`) on `:3000`.
- Host Postgres in docker-compose.
- k3d cluster hosts **only the dynamically-provisioned EB Job pods**, talking back to host via `host.k3d.internal:3000`.
- Provisioner uses host kubeconfig (`k3d-lastest`) — no in-pod ServiceAccount.
- `SYSTEM_EB_TOKEN`, `LASTEST_URL`, `EB_IMAGE` inlined into Job spec from host env.

This architecture maps to mobile almost without modification:

### Proposed "Embedded Android" (EA) pod

```
src/lib/eb/provisioner.ts          → generalize to src/lib/runtimes/{eb,ea}/provisioner.ts
packages/embedded-browser/         → add packages/embedded-android/
k8s/embedded-browser-job.yaml      → add k8s/embedded-android-job.yaml
```

The EA pod contains:
- Android emulator (Android 14 default) running with KVM.
- `adb` + UIAutomator2 server.
- A small Node/TypeScript agent that:
  - exposes the same WebSocket protocol as EB (frame stream + action injection),
  - translates `click → tap`, `selector → accessibility-id` or coords,
  - serves the accessibility-tree dump on demand,
  - records video via `adb shell screenrecord` (or scrcpy stream).
- Optionally Appium server pre-installed for advanced users / iOS parity.

Pod spec essentials:
```yaml
resources:
  requests: { cpu: "2", memory: "4Gi" }
  limits:   { cpu: "4", memory: "8Gi" }
volumeMounts:
  - { name: kvm, mountPath: /dev/kvm }
volumes:
  - { name: kvm, hostPath: { path: /dev/kvm, type: CharDevice } }
securityContext:
  privileged: true   # or capabilities: [SYS_PTRACE, NET_ADMIN]
```

### Bridging app uploads

Two upload sources:
- **App Store / Play Store** — for Play Store we can grab APKs via the user's own Play Store account or via mirroring (legal gray area; recommend manual upload). For App Store, only Apple-hardware sims/devices can install — outsource entirely.
- **Manual upload** — user uploads `.apk` / `.aab` / `.ipa` to lasTest. Store in the same blob store we use for screenshots. EA pod pulls from host via existing auth pattern; iOS path uploads to BrowserStack/Sauce.

### Capture protocol (recorder UX)

The web recorder records DOM events into Playwright steps. The mobile recorder records:
- `tap(accessibility-id|x,y)` — preferred locator strategy from the a11y dump, fallback to coords.
- `swipe(start, end, duration)`.
- `text-input(accessibility-id, text)`.
- `wait-for(accessibility-id|text)`.
- `screenshot(name)` — feeds the existing diff pipeline unchanged.
- `assert-text-present`, `assert-element-visible`.

This is essentially Maestro's command set. We could even adopt Maestro's YAML format as our serialized representation and run flows through Maestro itself for the v1, which gives us a working executor for free.

### iOS pragmatic path

Don't put iOS in the cluster. Instead:

1. Add a `MobileBackend` interface with implementations: `LocalAndroidEmulator` (the EA pod), `BrowserStackAppAutomate`, `SauceLabsRDC`, optionally `CorelliumAPI` later.
2. iOS tests are written against the same accessibility-id locators (Maestro-style); the backend handles routing to a real iPhone via Appium.
3. This mirrors how `packages/runner/` already works for remote browser runs — same pattern, different target.

### Schema additions

```ts
// in src/lib/db/schema.ts
export const mobilePlatform = pgEnum("mobile_platform", ["android", "ios"]);
export const mobileBackend = pgEnum("mobile_backend", ["local-emulator", "browserstack", "saucelabs", "corellium"]);

// mobile_test_flows — mirrors test_runs but with platform/backend/device fields
// mobile_app_builds — uploaded .apk/.aab/.ipa metadata
// mobile_screen_baselines — per-(test, platform, device, os-version) screenshot baselines
```

The visual-diff baselines table grows a `(platform, device, os_version)` composite — same diff engine, more dimensions.

### Phased plan

**Phase 1 — Android emulator in k3d (≈2 weeks):**
- New `packages/embedded-android` based on `budtmo/docker-android`.
- Provisioner mode `EB_PROVISIONER=android` or new `EA_PROVISIONER`.
- WebSocket protocol parity with EB (screenshot stream + tap injection).
- Manual `.apk` upload + `adb install` in the pod.
- Reuse `src/lib/diff/` for screenshot diffing.
- Recording UI: live emulator stream + tap-to-record, generates Maestro-style flow YAML.

**Phase 2 — iOS via cloud farm (≈1–2 weeks):**
- `MobileBackend` interface.
- BrowserStack App Automate integration (Appium-WebDriver client).
- Same flow YAML drives both Android (local) and iOS (cloud).

**Phase 3 — AI agent driving mobile flows (≈2 weeks):**
- New AI prompt templates for mobile (a11y-tree + screenshot).
- Tool defs: tap/swipe/text/wait/read-tree.
- Reuse `failure-triage.ts` for mobile screenshot diffs.
- Optional: Claude computer-use / Orbit-style agent that explores an app and proposes flows.

**Phase 4 — Optional infra upgrades:**
- Corellium API backend for non-Apple-hw iOS.
- Real-device farm support (Mac mini pool via Orka, or AWS Device Farm).
- Multi-device parallel runs.

---

## 6. Key tradeoffs and recommendation

**Build vs buy by platform:**

| | Build (in our cluster) | Buy (cloud farm) |
| --- | --- | --- |
| Android | **✅ Cheap, ~ matches our EB story** | Expensive per-minute; weak recording UX |
| iOS | ❌ Requires Mac hardware or Corellium ($$$) | **✅ The only sane MVP path** |

**Cost:** Android emulator pods are ~free at our scale (existing nodes have headroom). iOS via BrowserStack is ~$129/mo entry, ~$199/mo for Sauce RDC — usage-based above that. Corellium and Orka are enterprise-pricing; not MVP territory.

**Recommendation for partial-coverage MVP:**

1. **Implement Android natively** in the cluster as "EA" pods, mirroring EB. This is a high-leverage, low-risk extension of an architecture we already operate.
2. **Adopt Maestro's flow YAML as our serialization format** and ship the v1 executor by shelling out to `maestro test` inside the EA pod. We avoid reimplementing the accessibility-tree matcher, and we can swap to a custom executor later.
3. **For iOS, ship a thin BrowserStack adapter.** Same flow format, different runtime. Customers get cross-platform parity from day one without us buying any Mac hardware.
4. **Defer Corellium / Orka / Mac pool** until we have customers asking specifically for self-hosted iOS — by which point we'll know whether the answer is Corellium (license-friendly) or owning Mac minis (cheaper at scale).
5. **AI mobile agent layer comes for free** once we have the accessibility-tree dump exposed over our existing WebSocket — plug it into `src/lib/ai/` the same way browser AI features work today.

The total scope to working Android + cloud iOS + visual diff + recording UI is roughly 3–5 weeks of one engineer's time, mostly because the architecture parallels EB so closely. The biggest unknown is the host nested-virt situation in production deployments (Olares, ZimaBoard, customer self-hosts) — KVM access varies, and we may need to detect and gate the EA feature behind a "KVM available" check, similar to how we already gate Docker socket access.

---

## Sources

- [budtmo/docker-android (GitHub)](https://github.com/budtmo/docker-android)
- [google/android-emulator-container-scripts (GitHub)](https://github.com/google/android-emulator-container-scripts)
- [GKE nested virtualization docs](https://cloud.google.com/kubernetes-engine/docs/how-to/nested-virtualization)
- [AWS re:Post — Nested virtualization on Graviton](https://repost.aws/questions/QUEoabj2ZERq2P5QFL6d6-RQ/nested-virtualization-on-graviton)
- [MacStadium Orka](https://macstadium.com/orka) and [Orka On-Prem](https://macstadium.com/orka-onprem)
- [Corellium platform](https://www.corellium.com/platform), [corellium-api](https://github.com/corellium/corellium-api), [Corellium 7.7 release (iOS 26)](https://www.corellium.com/blog/corellium-introduces-ios-26-support-and-newest-mobile-device-models)
- [Maestro (GitHub)](https://github.com/mobile-dev-inc/Maestro), [Maestro docs — writing your first flow](https://docs.maestro.dev/getting-started/writing-your-first-flow), [Maestro vs Appium benchmark](https://maestro.dev/a/appium-maestro-the-benchmark)
- [Appium docs — drivers](https://appium.io/docs/en/2.19/intro/drivers/), [Appium XCUITest driver (GitHub)](https://github.com/appium/appium-xcuitest-driver)
- [Detox (GitHub)](https://github.com/wix/Detox)
- [BrowserStack vs Sauce Labs alternatives 2026 (Drizz)](https://www.drizz.dev/post/top-browserstack-alternatives-in-2026), [BrowserStack vs Sauce Labs pricing (Autonoma)](https://getautonoma.com/blog/browserstack-vs-saucelabs-2026)
- [Percy app visual testing](https://percy.io/blog/app-visual-testing), [Applitools visual testing for mobile apps](https://applitools.com/blog/visual-testing-for-mobile-apps/), [Visual regression in mobile QA 2026 (Panto)](https://www.getpanto.ai/blog/visual-regression-testing-in-mobile-qa)
- [VLMs in mobile app testing 2026 (Drizz)](https://www.drizz.dev/post/vision-language-models-the-next-frontier-in-ai-powered-mobile-app-testing)
- [MobAI — AI-native mobile automation](https://mobai.run/), [MobAI on DEV](https://dev.to/mobai_019d06386873d90ed58/ai-native-mobile-device-automation-give-your-ai-agent-eyes-and-hands-on-real-phones-43go)
- [Claude Orbit (Anthropic mobile agent)](https://claudeorbit.com/)
- [Teaching Claude to QA a Mobile App (Meiklejohn, Mar 2026)](https://christophermeiklejohn.com/ai/zabriskie/development/android/ios/2026/03/22/teaching-claude-to-qa-a-mobile-app.html)
- [Claude Code Mobile App Testing skill](https://mcpmarket.com/tools/skills/mobile-app-testing)
- [scrcpy (GitHub)](https://github.com/Genymobile/scrcpy)
- [Tart (Cirrus Labs)](https://github.com/cirruslabs/tart), [Cilicon (Trade Republic)](https://github.com/traderepublic/Cilicon)
