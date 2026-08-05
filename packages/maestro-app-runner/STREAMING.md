# Streaming feasibility — iOS simulator into Lastest's viewer (issue #197, step 2)

**Question:** is live streaming + interaction of the iOS simulator possible
outside Lastest, and how well would it plug into Lastest's existing viewer?

**Short answer:** Yes, it is possible and it is **built** — a live iOS-simulator
stream renders inside the real Lastest viewer (`/mobile`) and taps round-trip
back to the sim. The architectural fit is as good as predicted: `ios-bridge`'s
frame format is the **same shape** as Lastest's `stream:frame` (base64 JPEG in a
JSON envelope), so no new viewer or protocol was needed — just an idb-based frame
source + a mobile input mapping.

**But the stream quality is NOT production-usable**, and the reason is a hard
external constraint, not the design. See "Known limitations" below.

## Built — working local implementation

- Runner side: `src/stream.ts` — `iOS sim → idb video-stream --format h264 →
  ffmpeg (h264→mjpeg) → JPEG frame splitter → WS stream:frame`.
- Host side: the frames flow through Lastest's own authenticated
  `/api/embedded/stream` proxy.
- UI side: `src/app/(app)/mobile/` renders them in the **real `BrowserViewer`
  component** — the same one the browser EB uses — with `interactive` enabled, so
  clicking the canvas sends `stream:input` → `idb ui tap` on the simulator.

No mobile-specific viewer or protocol exists; the mobile runner registers as an
ordinary EB session and the existing pipeline carries it.

## Known limitations (measured, not guessed)

The blocker is **idb-companion 1.1.8** — which is the *newest release* (Aug 2022;
facebook/idb is actively developed but has not cut a release in ~4 years):

- **`--format mjpeg` produces 0 bytes.** The companion logs
  `createStreamWithConfiguration: succeeded` and mounts the framebuffer, so it
  accepts the config — the frames simply never reach the client. This looks like
  a client/companion bug, not a missing capability. mjpeg would have been ideal
  (every frame self-contained, no ffmpeg, no decode).
- **`--scale-factor` is ignored.** The h264 bitrate is unchanged whatever value
  is passed (~8.8 Mbit/s regardless), so ffmpeg always decodes full-resolution.
- **Consequence:** ffmpeg decodes at ~0.6× realtime and therefore falls
  progressively behind. What the viewer shows lags reality and appears to "stick"
  on stale frames. Lowering `STREAM_FPS` slows the drift but cannot fix it,
  because the knob that would (scale) is a no-op.
- **Input latency:** every tap spawns a fresh `idb ui tap` process (Python CLI
  startup + gRPC connect, several hundred ms). A persistent idb session would
  remove most of this.

### One real bug of ours, now fixed

The visible "tearing" was substantially **our own frame splitter**: it cut frames
at the first `0xFFD9` byte pair, but that sequence occurs naturally inside JPEG
entropy-coded data, so half-images were being sent. It now splits on `SOI`
(`FFD8FF`) boundaries and only emits complete frames. (An earlier note in this
file blamed H.264 keyframes — that was wrong.)

### Paths to a good stream (not attempted)

1. **Build idb-companion from source** — ~4 years of unreleased fixes; would
   likely restore mjpeg and/or scaling. Best outcome, uncertain effort.
2. **Screenshot polling** — `idb screenshot` measured ~7 fps; every frame whole
   and current, no ffmpeg. Lower framerate but immune to lag and tearing.
3. **Persistent idb connection** for input, to remove per-tap process startup.

---

## What Lastest's viewer already speaks

The browser EB streams over a WebSocket `StreamServer`
(`packages/embedded-browser/src/stream-server.ts`). The frontend consumes:

- **frames** — `{ type: "stream:frame", payload: { data: <base64 JPEG>, width,
height, timestamp } }` (JSON text messages; `broadcastFrame`, line 245).
- **status** — `{ type: "stream:status", payload: { status, currentUrl, … } }`.
- **input (client → server)** — `stream:input`, plus `stream:inspect_mode`,
  `stream:inspect_element_request`, `stream:dom_snapshot_request` (line 321+).

Source today = CDP screencast (JPEG frames). Input today = CDP
`Input.dispatchMouseEvent` / keyboard via `InputHandler`.

## What ios-bridge provides (from its source + STREAMING_ARCHITECTURE.md)

- **Frame capture:** `idb video-stream` (H.264) → JPEG @ quality 80, with
  FFmpeg-hwaccel / FFmpeg-sw / high-frequency screenshots as fallbacks. Capture
  loop up to 60 FPS; frame queue depth 3.
- **Frame wire format:** JSON text over `ws://…/ws/{session}/video`:
  ```json
  { "data": "<base64 JPEG>", "pixel_width": 1179, "pixel_height": 2556,
    "point_width": 393, "point_height": 852, "frame": N, "fps": F, "format": "jpeg" }
  ```
- **Control (input) format:** JSON over `ws://…/ws/{session}/control`:
  `{ "t": "tap", "x": …, "y": … }`, `swipe`, `text`, `button`, `key` — each
  executed via `idb ui tap|swipe|text|key|button --udid <sim>`.
- **Latency (stated):** WebSocket screenshot ~100–300ms; "ultra low-latency"
  optimized screenshots ~50–150ms; WebRTC ~20–100ms.
- **Stack:** Python 3.8+ / FastAPI, **idb + idb-companion**, optional FFmpeg,
  Xcode. macOS-only server; port 8000; `/api/sessions/*` REST + the WS channels.

## The fit

| Concern          | Lastest today              | ios-bridge                             | Gap                                                                                      |
| ---------------- | -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Frame payload    | base64 JPEG in JSON        | base64 JPEG in JSON                    | **≈none** — rename keys (`data`/`width`/`height` vs `data`/`pixel_width`/`pixel_height`) |
| Transport        | WS text JSON               | WS text JSON                           | same model                                                                               |
| Input events     | `stream:input` (mouse/key) | `{t:"tap"/"swipe"/"text"}`             | **map events**: viewer emits pointer coords → tap/swipe; keystrokes → text/key           |
| Frame source     | CDP screencast             | idb video-stream                       | different _source_, same _output_                                                        |
| Coordinate space | CSS px                     | device px + logical points (both sent) | straightforward scale                                                                    |

**So a mobile stream doesn't need a new viewer.** Two adapters bridge it:

1. **Frame adapter** — subscribe to ios-bridge's `/video` WS, re-wrap each frame
   into Lastest's `stream:frame` envelope, and feed the existing `StreamServer`
   (or have the mobile runner host a `StreamServer` and pump frames straight in).
2. **Input adapter** — translate `stream:input` pointer/key events into
   ios-bridge `{t:"tap"|"swipe"|"text"}` control messages (or call `idb ui …`
   directly, skipping ios-bridge's server entirely — see below).

## Two integration shapes

- **A) Wrap ios-bridge:** run its FastAPI server next to the mobile runner;
  runner proxies `/video` → `stream:frame` and `stream:input` → `/control`.
  Least capture code to write; adds a Python service + idb-companion to the
  local footprint.
- **B) Skip ios-bridge, use idb directly:** the runner itself runs
  `idb video-stream` for frames and `idb ui tap/…` for input, emitting Lastest's
  own `stream:frame` / consuming `stream:input`. No Python service; one extra
  dependency (`idb`). This mirrors what the browser EB already does
  (self-hosted `StreamServer`) and keeps everything in the TS runner. **Likely
  the cleaner path for Lastest** — ios-bridge is most useful as a reference
  implementation of the idb capture/input recipe.

Either way the **input side reuses what Maestro already proved**: we drove the
sim via the Maestro/`idb`/`simctl` layer and it worked, so tap/swipe/text into a
booted sim is a solved problem here.

## Local measurement on this machine

- `xcrun simctl io booted recordVideo` exists (h264/hevc → file) but is
  **post-hoc**, not live frames.
- `xcrun simctl io booted screenshot` ≈ **3 FPS** (~330ms/frame, ~3 MB PNG) —
  enough for a "watch progress" view, too slow for smooth interaction. This is
  ios-bridge's _fallback_ tier; its primary `idb video-stream` path is what gets
  to 30–60 FPS, so a real integration should use idb, not a screenshot loop.

## Verdict

Streaming is **feasible and low-conceptual-risk**: the viewer, the WS transport,
and the JSON frame/input model already exist and line up with ios-bridge's. The
effort is (1) an idb-based frame source, (2) a pointer→tap/swipe input mapping,
(3) coordinate scaling — all local-only, no containerization. Recommend shape
**B** (idb directly in the runner) with ios-bridge as the reference. Still a
distinct, larger workstream than run-only, so it stays **phase 2** after the
run pipeline (already proven) lands. Manual editing/recording would layer on the
same input path (or use `maestro studio`).
