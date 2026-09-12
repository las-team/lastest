# Demo video

A ~2½ minute screencast of the Veeva CRM → Vault CRM migration, with burned-in
subtitles and a standalone `.srt`.

| File | What it is |
| --- | --- |
| `veeva-migration-demo.mp4` | 1920×1080, 30 fps, H.264, no audio — subtitles are burned in |
| `veeva-migration-demo.srt` | the same narration as a sidecar subtitle track |
| `demo-run.ts` | drives the real engine and emits the timeline |
| `render.py` | turns the timeline into the video + subtitles |

## What it shows

Plan and load order → the materialised mapping → preflight → dry run → initial
load → the id crosswalk → a delta (rename, insert, hash-skip, delete policy) →
reconcile and the cutover gate → the run report.

Nothing on screen is mocked up for the video. `demo-run.ts` runs
`DefaultRunEngine` against the package's hermetic testkit (`FakeSfdcClient`,
`FakeVaultClient`, `MemoryStateStore`) — the same fakes the unit tests use — and
every table is printed from what the engine actually wrote to the state store,
the fake vault, or the run report. The engine's own pino lines are captured and
replayed as-is. There is no live Salesforce org and no live Vault.

## Rebuilding it

```bash
pip install pillow imageio-ffmpeg        # Pillow draws the frames, imageio-ffmpeg ships ffmpeg
pnpm --filter @lastest/veeva-migration demo
```

That is `tsx demo/demo-run.ts demo/timeline.jsonl` followed by
`python3 demo/render.py demo/timeline.jsonl demo/veeva-migration-demo.mp4`.
The timeline is a JSONL of `caption` / `line` / `chapter` / `card` events, so
the narration can be edited without re-running the engine — but re-run it after
changing the engine, or the video stops matching the code.

`render.py` composes two tracks on one clock: terminal states (typing at
`CPS_TYPE`, output lines with their own pauses) and subtitle cues (`CPS_READ`,
balanced at clause boundaries, `CAPTION_LEAD` of each block plays before the
terminal moves on). Only distinct states are drawn — a still second costs one
render, not thirty — and frames are streamed raw into ffmpeg.
