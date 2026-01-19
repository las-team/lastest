UI specification for Lastest/Kompromat

Based on the research, here is the recommended specification for the four key screens:
Screen 1: Build summary (dashboard home)
Purpose: Answer "Is this PR safe to merge?" in under 3 seconds
Layout:

Hero status indicator (top-left): Large badge showing overall state (Safe to Merge | Review Required | Blocked)
Metrics row: Total tests | Changes detected | Flaky | Failed | Time elapsed
Tests for review panel: Failed first, then Changes, then Flaky—sorted by impact
Quick actions bar: "Approve All Changes" button (green), "View Details" link
Recent history strip: Last 5 builds shown as colored squares (green/yellow/red)

Confidence signals:

"No visual changes detected" with green checkmark when applicable
"All changes auto-approved (carry-forward)" indicator
"Last build: 2 min ago" freshness indicator

Screen 2: Test list with grouped changes
Purpose: Show what changed and enable categorical approval
Layout:

Filter bar: Status filter (All | Changed | Failed | Flaky), Search, Browser/Viewport filter BrowserStack
Grouped test cards: Each test shows name, status badge, thumbnail preview, device count
Expand to show variants: Clicking card reveals browser/viewport breakdown
Batch selection: Checkbox selection with "Approve Selected" floating action button
Keyboard navigation: Arrow keys move between tests, Enter expands, A approves

Interaction pattern:

Hovering over thumbnail shows enlarged preview
Status badges use semantic colors with shape differentiation (checkmark, warning triangle, X) Carbon Design System
Changed areas in thumbnails subtly highlighted

Screen 3: Visual diff viewer
Purpose: Show exactly what changed and enable confident approval
Layout:

Header: Test name, status, browser/viewport selector tabs
Comparison area:

Default: Slider view with baseline (left of slider) and current (right)
Toggle: Side-by-side view
Toggle: Pixel diff overlay (changes highlighted in magenta)


Action bar: Approve (green), Reject (red), Skip (gray), Ignore Region (tool icon)
Context panel (collapsible right sidebar): Console errors, network requests, timing data
Navigation: Previous/Next test buttons, keyboard shortcuts displayed

Diff presentation:

Slider position remembered between tests
Zoom controls (fit/100%/200%) with pan capability
"Show only changed areas" toggle crops to bounding box of changes
Masked/ignored regions shown with purple overlay and "Ignored" label Katalon

Screen 4: Approval confirmation and PR integration
Purpose: Provide final confirmation and update PR status
Layout:

Summary card: "You're approving X visual changes across Y tests"
Change breakdown: List of approved changes with mini thumbnails
PR context: Link to GitHub PR, branch name, commit SHA
Confirmation button: "Approve and Update PR" (single click)
Undo option: "Undo" link visible for 10 seconds post-approval

GitHub integration:

Status check updates to "✓ All visual changes approved" BrowserStack
Optional PR comment with summary and thumbnails
Deep link back to dashboard from status check


Wireframe concepts for confidence-building patterns
Pattern A: Status-first hero
┌─────────────────────────────────────────────────────────────┐
│  🟢 SAFE TO MERGE                              PR #142     │
│  ─────────────────                                          │
│  No changes require review                                  │
│                                                             │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                           │
│  │  47 │ │   0 │ │   0 │ │ 1.2s│                           │
│  │Tests│ │Chngd│ │Flaky│ │ Time│                           │
│  └─────┘ └─────┘ └─────┘ └─────┘                           │
│                                                             │
│  Last 5 builds: 🟢🟢🟢🟢🟢                                  │
└─────────────────────────────────────────────────────────────┘
Pattern B: Exception-first list
┌─────────────────────────────────────────────────────────────┐
│  🟡 REVIEW REQUIRED (3 changes)              [Approve All] │
├─────────────────────────────────────────────────────────────┤
│  ⚠️ Button component                                        │
│     │ Padding changed: 12px → 16px                          │
│     │ [Chrome Desktop] [Safari Mobile] [+2 more]            │
│     └─ [Thumbnail ▢] [Thumbnail ▢]                          │
│                                                             │
│  ⚠️ Header navigation                                       │
│     │ New menu item added                                   │
│     │ [Chrome Desktop] [Firefox Desktop]                    │
│     └─ [Thumbnail ▢] [Thumbnail ▢]                          │
│                                                             │
│  ℹ️ Footer (auto-approved)                                  │
│     │ Copyright year updated                                │
│     └─ Matches previous approval                            │
└─────────────────────────────────────────────────────────────┘
Pattern C: Slider diff viewer
┌─────────────────────────────────────────────────────────────┐
│  Button component          [Chrome] [Safari] [Firefox ▼]   │
│  ← Prev  |  Next →                          [✓] [✗] [Skip] │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │    BASELINE        │ ◀─ slider ─▶ │    CURRENT      │  │
│  │                    │              │                  │  │
│  │    [  Button  ]    │              │   [ Button  ]   │  │
│  │                    │              │   ▲ changed     │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  [Slider] [Side-by-side] [Overlay]     [Fit] [100%] [200%] │
└─────────────────────────────────────────────────────────────┘

Key recommendations for solo founder persona

Default to "safe" messaging: When no changes detected, show large green "Safe to Merge" indicator—don't make users hunt for confirmation
One-click approval path: The most common action (approving unchanged or minor changes) should require exactly one click
Carry forward approvals: Once approved, identical changes shouldn't require re-review on subsequent commits BrowserStack
Mobile-friendly approval: Enable PR approval from phone with swipe gestures and minimal UI
Smart notifications: Only alert for blocking issues; batch informational updates into daily digest
Show historical context: "Last 5 builds passed" indicator provides confidence without deep investigation
Explicit flaky handling: Show flaky tests separately from failures—train users to trust the failure indicator

The goal is to make the dashboard feel like a traffic light: green means go, yellow means look, red means stop. Solo founders with traction need a tool that protects them from breaking production while respecting that their attention is their scarcest resource.