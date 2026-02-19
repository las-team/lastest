## in progress
## test
VS Code extension
Github actions integration
Publish lastest runner to npx npm
Docker
Gitlab
Timestamp fixing
Teardown
Test - which pr it was added in, updated?
AI review
## features
Support https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw/tests ~/.claude/plans/declarative-kindling-coral.md 55%

## ideas
Content comparison - compare text in 2 setups
Explore/Cover instead of Areas
Ban AI mode
    Remove all GenAI features from UI if enabled
Revise labels (e.g. new change, main 2.5%) on build page
Component specific testing
Electron app ~/.claude/plans/rippling-roaming-snail.md replan
Figma plugin
Generate test data with AI
Sitemap -flow

Tweet about us

Import from prior tools?
Formal verification of code?

### UX
## bugs
Automated test add
Page Shift
## marketing 

## Excalidraw 

 Tests to Record (Priority Order)

  Tier 1 — High impact, directly recordable now:

  #: 1
  Test Name: Context Menu Actions
  Maps to: contextmenu.test
  Steps: Right-click element → copy/paste/delete/duplicate/group
  ────────────────────────────────────────
  #: 2
  Test Name: Keyboard Shortcuts — Shape Tools
  Maps to: shortcuts.test
  Steps: Press R/E/D/L/A/O keys, verify tool activates
  ────────────────────────────────────────
  #: 3
  Test Name: Tool Switching via Toolbar
  Maps to: tool.test
  Steps: Click each toolbar icon, verify active state
  ────────────────────────────────────────
  #: 4
  Test Name: Box Selection + Shift-Click
  Maps to: selection.test
  Steps: Drag-select multiple elements, shift-click to add/remove
  ────────────────────────────────────────
  #: 5
  Test Name: Drag Create All Shapes
  Maps to: dragCreate.test
  Steps: Create rectangle, ellipse, diamond, line, arrow, freedraw
  ────────────────────────────────────────
  #: 6
  Test Name: Flip Horizontal/Vertical
  Maps to: flip.test
  Steps: Select element → use flip shortcuts or context menu
  ────────────────────────────────────────
  #: 7
  Test Name: Element Locking
  Maps to: elementLocking.test
  Steps: Lock element via context menu → verify no drag/resize
  ────────────────────────────────────────
  #: 8
  Test Name: Multi-Point Line/Arrow
  Maps to: multiPointCreate.test
  Steps: Click multiple points to create polyline, double-click to finish
  ────────────────────────────────────────
  #: 9
  Test Name: Canvas Scroll + Zoom
  Maps to: scroll.test
  Steps: Mouse wheel to zoom, space+drag to pan
  ────────────────────────────────────────
  #: 10
  Test Name: Fit to Content
  Maps to: fitToContent.test
  Steps: Create elements off-screen → Ctrl+Shift+1 to fit

  Tier 2 — Good coverage, slightly more complex:

  #: 11
  Test Name: Color/Style Changes
  Maps to: actionStyles.test + colorInput.test
  Steps: Select element → change stroke color, fill, stroke width
  ────────────────────────────────────────
  #: 12
  Test Name: View Mode Toggle
  Maps to: viewMode.test
  Steps: Toggle view mode → verify toolbar hidden, no editing
  ────────────────────────────────────────
  #: 13
  Test Name: Search Elements
  Maps to: search.test
  Steps: Ctrl+F → search text → verify element highlighted
  ────────────────────────────────────────
  #: 14
  Test Name: Lasso Selection
  Maps to: lasso.test
  Steps: Freehand lasso around multiple elements
  ────────────────────────────────────────
  #: 15
  Test Name: Laser Pointer
  Maps to: laser.test
  Steps: Activate laser tool → draw path → verify fade

  Tier 3 — Needs product improvements first:

  ┌─────┬─────────────────────┬─────────────────────────┬────────────────┐
  │  #  │      Test Name      │       Blocked by        │    Maps to     │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 16  │ Copy/Paste Elements │ Clipboard support       │ clipboard.test │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 17  │ Export as PNG/SVG   │ Download interception   │ export.test    │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 18  │ Insert Image        │ File upload support     │ image.test     │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 19  │ Library Add/Use     │ File upload + clipboard │ library.test   │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 20  │ Paste CSV as Chart  │ Clipboard support       │ charts.test    │
  └─────┴─────────────────────┴─────────────────────────┴────────────────┘