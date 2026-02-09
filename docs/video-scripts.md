# Video & GIF Scripts

---

## 30-Second Demo GIF Script

**Purpose:** Silent, fast-paced screen recording showing the core Record → Test → Diff → Approve loop. Embedded in README and shared on social.

**Format:** GIF or WebM, 720px wide, 15-20fps, looping

**Recording tool:** OBS (record MP4 at 1440x900, crop to 1280x800, convert with ffmpeg)

### Storyboard

| Time | Screen | Action | What viewer sees |
|------|--------|--------|-----------------|
| 0:00-0:03 | `/record` page | Click "Start Recording", browser opens target app | Recording UI launching |
| 0:03-0:08 | Target app in recorder | Click through 3-4 elements — navigate, click a button, fill a field | Real browser interaction being captured |
| 0:08-0:10 | `/record` page | Click "Stop Recording" → AI generation starts | Spinner: "Generating test code..." |
| 0:10-0:13 | `/tests/[id]` page | Test code appears with AI-generated Playwright code | Code editor showing clean test code |
| 0:13-0:16 | `/run` page | Click "Run" → test executes, progress bar fills | Test running with live progress |
| 0:16-0:20 | `/builds/[buildId]` | Build results appear — green checks, screenshot thumbnails | Build dashboard with pass/fail status |
| 0:20-0:25 | `/builds/[buildId]/diff/[diffId]` | Visual diff view — side-by-side baseline vs new, diff overlay highlighted | The money shot: visual comparison with changes highlighted |
| 0:25-0:28 | Same diff page | Click "Approve" button → baseline updated | Approval workflow in action |
| 0:28-0:30 | Fade to text overlay | "Lastest2 — Record. Test. Ship. $0 forever." | End card |

### Recording tips
- Use a **clean demo app** (e.g., a simple todo app or e-commerce page) with visible UI elements
- **Pre-seed** the database with a baseline so the diff view shows actual changes
- Make a **small CSS change** between baseline and current (e.g., change a button color or move an element) so the diff overlay is visually obvious
- Keep mouse movements **smooth and deliberate** — speed up in post, don't rush during recording
- Record at **1.0x speed**, then speed up to **2.0-2.5x** in editing
- Crop browser chrome — show only the Lastest2 UI and target app, no OS taskbar
- Add a subtle **cursor highlight** ring so viewers can follow the mouse

### ffmpeg conversion
```bash
# MP4 → GIF (720px wide, 15fps, optimized palette)
ffmpeg -i demo-recording.mp4 -vf "fps=15,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 docs/demo.gif

# Or MP4 → WebM (better quality, smaller, but needs <video> tag)
ffmpeg -i demo-recording.mp4 -vf "fps=20,scale=720:-1" -c:v libvpx-vp9 -b:v 500k docs/demo.webm
```

---

## 3-Minute Demo Video Script

**Purpose:** Narrated walkthrough for YouTube, website embed, and social sharing. Converts skeptics by showing the full workflow with context.

**Format:** MP4, 1920x1080, screen recording + voiceover (no face cam needed)

**Tone:** Casual, technical, developer-to-developer. No corporate hype. Like explaining to a colleague.

---

### INTRO (0:00 - 0:20)

**[Screen: Lastest2 dashboard — empty state or landing page]**

> "Visual regression testing sucks. It's either expensive — Percy charges five grand a month at scale — or it's flaky pixel diffs that flag every font rendering difference. Or you're maintaining hundreds of Playwright screenshots in your git repo like it's 2019.
>
> Lastest2 is different. It's free, self-hosted, open source, and it uses AI to write your tests for you. Let me show you how it works."

---

### RECORDING A TEST (0:20 - 0:55)

**[Screen: Navigate to `/record` page]**

> "You start by recording. Pick a test area — say, your checkout flow — and hit Record."

**[Action: Click "Start Recording". Browser opens target app]**

> "Lastest2 opens your app in a real browser. I'm going to click around like a user would — navigate to a product page, add something to cart, go to checkout."

**[Action: Interact with target app — 3-4 clicks, maybe fill a form field. Show the recorder capturing actions in the sidebar]**

> "Every click, every keystroke, every navigation is captured. You don't write any code. Just use your app."

**[Action: Click "Stop Recording"]**

> "When I stop, the AI takes over."

---

### AI TEST GENERATION (0:55 - 1:20)

**[Screen: AI generation in progress — spinner, then test code appears]**

> "Claude analyzes the recording and generates Playwright test code. Notice it's using resilient selectors — data-testid first, then role, then aria-label. If one selector breaks, it falls back to the next. That's what makes these tests survive DOM changes."

**[Screen: Scroll through the generated test code in the test editor]**

> "This is real Playwright code. You can edit it, enhance it, or just run it as-is. If you want, you can also skip recording entirely and generate tests from an OpenAPI spec or a user story — just feed it a markdown file."

---

### RUNNING THE TEST (1:20 - 1:50)

**[Screen: Navigate to `/run` page or click "Run" on the test]**

> "Let's run it."

**[Action: Click Run. Show test executing — progress bar, step indicators]**

> "The test replays your recorded flow. At each step, it captures a screenshot. These get compared against your baselines using perceptual diffing — not just raw pixels, but SSIM and Butteraugli algorithms that see like a human eye. So anti-aliasing differences and font rendering won't trigger false positives."

**[Screen: Test completes. Show the build results with pass/fail]**

> "Done. Let's look at the results."

---

### VISUAL DIFF REVIEW (1:50 - 2:25)

**[Screen: Navigate to build detail → click into a diff]**

> "Here's the build. Three screenshots were captured. Two are unchanged — the hash matches the baseline, so they're instant green. One has a visual change."

**[Action: Click into the changed diff. Show side-by-side view]**

> "This is the diff view. Left is the baseline, right is the new screenshot. The overlay shows exactly what changed — in this case, someone updated the button styling."

**[Action: Toggle between diff overlay modes if available]**

> "The AI also classifies this change automatically — it tells you whether this looks intentional or like a regression, with a confidence score."

**[Action: Click "Approve"]**

> "I'll approve it. This becomes the new baseline. Next time this test runs, it compares against this approved screenshot."

---

### WHAT MAKES IT DIFFERENT (2:25 - 2:50)

**[Screen: Quick montage — settings page showing AI providers, accessibility tab, Google Sheets integration, remote runners list]**

> "A few things that set Lastest2 apart from everything else out there:
>
> It's completely self-hosted — your screenshots never leave your server. There's no per-screenshot pricing, no cloud dependency.
>
> If a test breaks because your UI changed, the AI can auto-fix it. No other tool does this.
>
> It runs accessibility audits on every screenshot automatically with axe-core.
>
> You can use five different AI providers, including Ollama for fully local AI with zero API costs.
>
> And it's MIT licensed. Free forever."

---

### CLOSE (2:50 - 3:00)

**[Screen: GitHub repo page or Lastest2 dashboard]**

> "Lastest2 is on GitHub. Clone it, docker-compose up, and you're running visual regression tests in under two minutes. Link in the description.
>
> Star the repo if this is useful. PRs welcome."

**[Screen: End card with GitHub URL and star button]**

---

### Production notes

- **Demo app:** Use a visually clean app (e-commerce, dashboard, or SaaS UI). Avoid anything that looks like a toy
- **Pre-seed the diff:** Before recording the video, create a baseline run. Then make a visible CSS change (button color, spacing, font size) so the diff view has something interesting to show
- **Screen resolution:** Record at 1920x1080. Use browser at ~1440x900 with Lastest2 UI, leaving room for padding
- **Voiceover:** Record separately from screen capture. Speak naturally, not scripted-sounding. OK to ad-lib around the key points above
- **Music:** Optional subtle lo-fi background, very low volume. Or just clean audio
- **Editing:** Cut dead time (loading spinners, typing). Speed up repetitive actions (2x). Keep transitions simple (cuts, no fancy effects)
- **Captions:** Add burned-in captions — many devs watch on mute
- **Thumbnail:** Split screen showing "Before" and "After" with a visual diff overlay. Text: "Free Visual Regression Testing with AI"
