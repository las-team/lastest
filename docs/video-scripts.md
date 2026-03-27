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



  Screenshot Inventory & Script Mapping              
                                                     
  #: 1                                               
  Screenshot: 20-22-00                               
  Shows: Dashboard — onboarding stepper, 1 test,     
  fresh                                        
    setup
  Script Section: INTRO (fresh install story)        
  ────────────────────────────────────────
  #: 2                                               
  Screenshot: 20-22-18     
  Shows: Dashboard — 29 tests, selector stats, recent
                           
    builds
  Script Section: INTRO (mature dashboard)
  ────────────────────────────────────────
  #: 3                                               
  Screenshot: 20-02-33
  Shows: Dashboard — 29 tests, plan tasks, onboarding
                           
    complete
  Script Section: INTRO (alt angle)
  ────────────────────────────────────────
  #: 4                                               
  Screenshot: 20-22-24
  Shows: Areas — functional area tree, discovery     
    actions (Scan Routes, Analyze Specs, Import,
    Discover, Code Diff)
  Script Section: WHAT MAKES IT DIFFERENT
  ────────────────────────────────────────
  #: 5                                               
  Screenshot: 20-22-38
  Shows: Tests list — 59 tests, pass/fail counts,    
    functional areas       
  Script Section: RUNNING THE TEST
  ────────────────────────────────────────
  #: 6                                               
  Screenshot: 20-22-51
  Shows: Tests list — same but scrolled, showing more
                           
    test categories
  Script Section: RUNNING THE TEST (alt)
  ────────────────────────────────────────
  #: 7                                               
  Screenshot: 20-22-58
  Shows: Create Test with AI dialog — describe       
  prompt,                  
    target URL
  Script Section: AI TEST GENERATION
  ────────────────────────────────────────
  #: 8                                               
  Screenshot: 20-23-05
  Shows: New Recording page — target URL, recording  
    settings, selector priority, stabilization
  toggles
  Script Section: RECORDING A TEST
  ────────────────────────────────────────
  #: 9                                               
  Screenshot: 20-23-42
  Shows: Recorder in action — Google open in embedded
                           
    browser, timeline panel showing captured actions
  Script Section: RECORDING A TEST (active recording)
  ────────────────────────────────────────
  #: 10                                              
  Screenshot: 20-24-49
  Shows: Recorder — similar but with more actions in 
    timeline               
  Script Section: RECORDING A TEST (mid-recording)
  ────────────────────────────────────────
  #: 11                                              
  Screenshot: 20-25-05
  Shows: Compose Build — main branch baseline, build 
    configuration checklist
  Script Section: WHAT MAKES IT DIFFERENT
  ────────────────────────────────────────
  #: 12                                              
  Screenshot: 20-25-11
  Shows: Environment Setup — setup/teardown steps,   
    drag-to-order, API configs
  Script Section: WHAT MAKES IT DIFFERENT
  ────────────────────────────────────────
  #: 13                                              
  Screenshot: 20-25-17
  Shows: Run Tests — Smart Run, base URL, changes    
    detected, build history chart
  Script Section: RUNNING THE TEST
  ────────────────────────────────────────
  #: 14                                              
  Screenshot: 20-25-47
  Shows: Compare Branches — V1.7 vs V1.8,            
  side-by-side             
    build comparison
  Script Section: WHAT MAKES IT DIFFERENT
  ────────────────────────────────────────
  #: 15                                              
  Screenshot: 20-26-09
  Shows: Build Results — 55 passed, 4 failed, 18     
    errors, 22 changed, 14 flaky, 93% pass rate, test

    cases for review
  Script Section: VISUAL DIFF REVIEW
  ────────────────────────────────────────
  #: 16                                              
  Screenshot: 20-26-19
  Shows: Test Page diff — slider mode, pixel changes 
    count, selector stats, expected change / add to
    todo buttons
  Script Section: VISUAL DIFF REVIEW (the money shot)
  ────────────────────────────────────────
  #: 17                                              
  Screenshot: 20-27-32
  Shows: Suites — drag tests into suite, available   
    tests tree             
  Script Section: WHAT MAKES IT DIFFERENT
  ────────────────────────────────────────
  #: 18                                              
  Screenshot: 20-28-06
  Shows: Review — developer todos, branch overview,  
    pending tests          
  Script Section: VISUAL DIFF REVIEW
  ────────────────────────────────────────
  #: 19                                              
  Screenshot: 20-28-29
  Shows: Impact — PR Impact Timeline, issues by week 
    chart, merged PRs      
  Script Section: WHAT MAKES IT DIFFERENT

  Recommended sequence for the video                 
  
  INTRO:          #1 → #2 (fresh install → mature    
  dashboard)                                         
  RECORDING:      #8 → #9 → #10 (settings → recording
   → mid-recording)                                  
  AI GENERATION:  #7 (Create Test with AI dialog)
  RUNNING:        #13 → #5 (Smart Run → tests list)  
  DIFF REVIEW:    #15 → #16 → #18 (build results →
  slider diff → review todos)                        
  DIFFERENTIATORS: #4 → #12 → #11 → #17 → #14 → #19
                  (areas → env setup → compose →     
  suites → branch compare → impact)                  
  CLOSE:          #2 (back to dashboard, full circle)
                                                     
  Ready-to-use prompt for Remotion / Replit Animation
   / any AI video tool                               
                                                     
  Create an animated product demo video for          
  "Lastest2", a visual regression                    
  testing platform. Use the following screenshots as 
  keyframes, in this exact order.                    
                           
  STYLE:                                             
  - Dark, professional developer tool aesthetic
  - Smooth Ken Burns zoom into relevant UI areas on  
  each screenshot                                    
  - Crossfade transitions (0.4s) between screenshots 
  - Bottom-third text captions for narration (white  
  text, semi-transparent                             
    dark background, Inter font)                     
  - Subtle highlight glow (teal #14b8a6) around key  
  UI elements being discussed                        
  - Animated cursor pointing to features being
  narrated                                           
  - 1920x1080, 30fps       
                                                     
  SEQUENCE:
                                                     
  [0:00-0:05] Screenshot 20-22-00.png — "Fresh       
  install dashboard"
  Caption: "Visual regression testing that's free,   
  self-hosted, and AI-powered"                       
  Zoom: Into the onboarding stepper showing setup
  progress                                           
                           
  [0:05-0:10] Screenshot 20-22-18.png — "Mature      
  dashboard with 29 tests" 
  Caption: "From zero to full coverage — here's how"
  Zoom: Pan across stats cards (29 tests, passing,   
  selector stats)                                    
                                                     
  [0:10-0:18] Screenshot 20-23-05.png — "Recording   
  settings page"           
  Caption: "Start by recording. Configure selectors, 
  stabilization, and hit Record"                     
  Zoom: Into the recording settings panel, highlight
  selector priority toggles                          
                           
  [0:18-0:26] Screenshot 20-23-42.png — "Browser     
  recorder capturing Google"
  Caption: "Lastest2 opens a real browser. Every     
  click and keystroke is captured"                   
  Zoom: From embedded browser → timeline panel
  showing captured actions                           
                           
  [0:26-0:32] Screenshot 20-24-49.png — "Recording   
  with full timeline"      
  Caption: "The timeline tracks every interaction for
   playback"               
  Zoom: Into the timeline panel
                                                     
  [0:32-0:40] Screenshot 20-22-58.png — "Create Test
  with AI dialog"                                    
  Caption: "Or skip recording — describe what to test
   and AI generates the code"                        
  Zoom: Into the dialog, highlight the prompt field
  and Generate button                                
                           
  [0:40-0:50] Screenshot 20-25-17.png — "Run Tests   
  with Smart Run"
  Caption: "Smart Run analyzes your git diff and only
   runs affected tests"                              
  Zoom: Into Smart Run toggle → changes detected →
  build history chart                                
                           
  [0:50-0:58] Screenshot 20-22-38.png — "Tests list  
  with 59 tests"
  Caption: "59 tests across functional areas — all   
  AI-generated, all maintainable"                    
  Zoom: Pan down the test list
                                                     
  [0:58-1:08] Screenshot 20-26-09.png — "Build       
  results dashboard"
  Caption: "Build results: 93% pass rate. Filter by  
  changed, flaky, or AI recommendation"              
  Zoom: Into metrics row (55 passed, 22 changed, 14
  flaky) → filter buttons                            
                           
  [1:08-1:20] Screenshot 20-26-19.png — "Visual diff 
  slider view"             
  Caption: "The money shot: 6 diff modes including
  slider, overlay, and shift-compare"                
  Zoom: Into the slider comparison, highlight pixel
  change count and approve buttons                   
  *This is the hero shot — hold longer, add subtle
  pulsing glow on diff area*                         
                           
  [1:20-1:28] Screenshot 20-28-06.png — "Review page 
  with developer todos"    
  Caption: "Review tracks every todo — keyboard
  shortcuts make approval fast"                      
  Zoom: Into developer todos → branch overview
                                                     
  [1:28-1:36] Screenshot 20-22-24.png — "Functional  
  Areas with discovery"                              
  Caption: "AI discovers your routes and organizes   
  tests into functional areas"                       
  Zoom: Pan across discovery actions (Scan Routes,
  Analyze Specs, Import)                             
                           
  [1:36-1:42] Screenshot 20-25-11.png — "Environment 
  Setup"
  Caption: "Setup and teardown orchestration — seed  
  data, configure auth, clean up"                    
  Zoom: Into the drag-to-order steps panel
                                                     
  [1:42-1:48] Screenshot 20-25-05.png — "Compose
  Build"                                             
  Caption: "Compose builds with version pinning
  across your entire test suite"                     
  Zoom: Into the build configuration checklist
                                                     
  [1:48-1:54] Screenshot 20-27-32.png — "Suites
  management"
  Caption: "Organize tests into suites with
  drag-and-drop"                                     
  Zoom: Into the suite panel
                                                     
  [1:54-2:02] Screenshot 20-25-47.png — "Branch      
  comparison"
  Caption: "Compare any two branches side-by-side —  
  catch regressions before merge"                    
  Zoom: V1.7 panel → V1.8 panel, highlight status
  badges (success vs failed)                         
                           
  [2:02-2:10] Screenshot 20-28-29.png — "PR Impact   
  Timeline"                
  Caption: "Track the impact of every PR on your
  visual test health over time"                      
  Zoom: Into the issues-by-week chart
                                                     
  [2:10-2:16] Screenshot 20-22-18.png — "Back to
  dashboard"                                         
  Caption: "Lastest2 — Record. Test. Ship. Free
  forever."                                          
  Zoom: Pull back to show full dashboard, fade to end
   card                                              
                           
  END CARD [2:16-2:20]:                              
  Black background, centered text:
  "Lastest2" (large, teal)                           
  "github.com/..." (smaller, white)                  
  "Star ⭐ if useful"                                
                                                     
  This prompt works with Remotion, Replit Animation, 
  Motion Canvas, or even video-focused AI tools like 
  Runway. Want me to scaffold an actual Remotion     
  project with this sequence, or would you prefer to
  feed this prompt into an external tool?