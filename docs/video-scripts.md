# Video & GIF Scripts

---

## 30-Second Demo GIF Script

**Purpose:** Silent, fast-paced screen recording showing the core Record → Test → Diff → Approve loop. Embedded in README and shared on social.

**Format:** GIF or WebM, 720px wide, 15-20fps, looping

**Recording tool:** OBS (record MP4 at 1440x900, crop to 1280x800, convert with ffmpeg)

### Storyboard

| Time | Screen | Action | What viewer sees |
|------|--------|--------|-----------------|
| 0:00-0:03 | `/record` page | Click "Start Recording", browser opens target app | Recording UI launching with engine selector visible |
| 0:03-0:08 | Target app in recorder | Click through 3-4 elements — navigate, click a button, fill a field | Real browser interaction being captured |
| 0:08-0:10 | `/record` page | Click "Stop Recording" → AI generation starts | Spinner: "Generating test code..." |
| 0:10-0:13 | `/tests/[id]` page | Test code appears with AI-generated Playwright code | Code editor with multi-selector fallback visible |
| 0:13-0:16 | `/run` page | Click "Run" → test executes, progress bar fills | Test running with live progress |
| 0:16-0:20 | `/builds/[buildId]` | Build results appear — green checks, screenshot thumbnails, metrics row (total/changed/flaky/passed) | Build dashboard with safe_to_merge status |
| 0:20-0:25 | `/builds/[buildId]/diff/[diffId]` | Visual diff view — toggle slider mode, show diff overlay | The money shot: slider comparison with change regions highlighted |
| 0:25-0:28 | Same diff page | Click "Approve" (or press E keyboard shortcut) → baseline updated | Approval workflow in action |
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

**[Screen: Lastest2 dashboard — stats cards showing total tests, pass/fail counts, functional area coverage, recent builds with pass-rate bars]**

> "Visual regression testing sucks. It's either expensive — Percy charges five grand a month at scale — or it's flaky pixel diffs that flag every font rendering difference. Or you're maintaining hundreds of Playwright screenshots in your git repo like it's 2019.
>
> Lastest2 is different. It's free, self-hosted, open source, and it uses AI to write your tests, fix them when they break, and tell you whether a visual change is a regression or noise. Let me show you."

---

### RECORDING A TEST (0:20 - 0:55)

**[Screen: Navigate to `/record` page — show recording engine selector (custom recorder vs Playwright Inspector)]**

> "You start by recording. Pick a test area — say, your checkout flow — and hit Record. You can use our custom recorder or Playwright Inspector — both capture everything."

**[Action: Click "Start Recording". Browser opens target app]**

> "Lastest2 opens your app in a real browser. I'm going to click around like a user would — navigate to a product page, add something to cart, go to checkout."

**[Action: Interact with target app — 3-4 clicks, maybe fill a form field. Show the recorder capturing actions. Capture a manual screenshot mid-flow]**

> "Every click, every keystroke, every navigation is captured. I can also capture manual screenshots at key steps for multi-step comparison. It even auto-detects what browser capabilities your app needs — file uploads, clipboard, downloads."

**[Action: Click "Stop Recording"]**

> "When I stop, the AI takes over."

---

### AI TEST GENERATION (0:55 - 1:20)

**[Screen: AI generation in progress — spinner, then test code appears]**

> "Claude analyzes the recording and generates Playwright test code. Notice it's using resilient selectors — data-testid first, then role, then aria-label, with OCR fallback. If one selector breaks, it falls back to the next. That's what makes these tests survive DOM changes."

**[Screen: Scroll through the generated test code in the test editor. Show version history tab briefly]**

> "This is real Playwright code. You can edit it, enhance it, or just run it as-is. Every edit is versioned so you can always roll back. And if you want to skip recording entirely, you can generate tests from an OpenAPI spec, user stories, or let AI discover your routes automatically."

---

### RUNNING THE TEST (1:20 - 1:50)

**[Screen: Navigate to `/run` page — show Smart Run option and base URL with connection test]**

> "Let's run it. I can run all tests, or use Smart Run — which analyzes my git diff and only runs tests affected by my changes."

**[Action: Click Run. Show test executing — progress bar, step indicators]**

> "The test replays the recorded flow. At each step, it captures screenshots. These get compared against baselines using three diff engines — pixelmatch for pixel-perfect, SSIM for structural similarity, and Butteraugli that sees like a human eye. There's even text-region-aware diffing that handles font rendering differences. Accessibility audits run automatically on every capture."

**[Screen: Test completes. Show the build results with metrics row — total/changed/flaky/passed/failed/errors]**

> "Done. Let's look at the results."

---

### VISUAL DIFF REVIEW (1:50 - 2:25)

**[Screen: Navigate to build detail — show filter buttons (all/changed/flaky/failed/passed/AI categories), metrics row]**

> "Here's the build. It tells me the overall status — safe to merge, needs review, or blocked. I can filter by changed, flaky, failed, or what the AI recommends."

**[Action: Click into a changed diff. Show the slider comparison mode]**

> "This is the diff view with six comparison modes — slider, side-by-side, overlay, three-way, planned-versus-actual for comparing against Figma designs, and shift-compare for detecting content that moved."

**[Action: Toggle to overlay mode, show changed region bounding boxes]**

> "The AI classifies every change — insignificant noise, or a real regression — with a confidence score and a recommendation to approve, review, or flag."

**[Action: Press E to approve, then use arrow keys to navigate to next diff]**

> "Keyboard shortcuts make review fast — E to approve, T to mark as todo, S to skip, arrows to navigate. Or hit 'Accept All Safe' to bulk-approve everything the AI says is fine."

---

### WHAT MAKES IT DIFFERENT (2:25 - 2:50)

**[Screen: Quick montage — settings page showing AI providers with Ollama, testing templates grid, setup/teardown step builder, remote runners list, functional areas tree with drag-drop, compose page with version sliders, debug mode with step-through controls, review page with developer todos]**

> "A few things that set Lastest2 apart:
>
> It's completely self-hosted — your screenshots never leave your server. No per-screenshot pricing, no cloud dependency.
>
> If a test breaks because your UI changed, the AI auto-fixes it. No other free tool does this.
>
> You get 12 stabilization features — timestamp freezing, random seeding, burst capture, auto-masking dynamic content, network idle waiting — so your tests don't flake.
>
> There's a full debug mode for stepping through tests, setup and teardown orchestration, test composition with version pinning, and 8 testing templates for instant configuration.
>
> Five AI providers including Ollama for fully local AI with zero API costs. GitHub and GitLab integration with PR comments and webhook-triggered builds. Remote runners for distributed execution.
>
> And it's MIT licensed. Free forever."

---

### CLOSE (2:50 - 3:00)

**[Screen: GitHub repo page or Lastest2 dashboard]**

> "Lastest2 is on GitHub. Clone it, docker-compose up, and you're running visual regression tests in under two minutes. Or use the GitHub Action for zero-config CI/CD. Link in the description.
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
- **Feature callouts:** Consider brief text overlays when showing features (e.g., "6 diff modes", "12 stabilization features", "Smart Run") to reinforce key differentiators for muted viewers
