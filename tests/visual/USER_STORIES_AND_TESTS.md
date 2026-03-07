# User Stories & Acceptance Criteria - Extracted from Lastest2 Documentation

## Overview

This document contains User Stories (US) and Acceptance Criteria (AC) extracted from the Lastest2 project documentation, along with corresponding Playwright visual regression tests.

---

## User Stories from README.md Features

### US-001: AI-Free Manual Recording

**User Story:**
**As a** developer who doesn't want to use AI
**I want to** record browser interactions without AI involvement
**So that** I can create deterministic tests in air-gapped environments

**Acceptance Criteria:**
- **AC-001.1:** User can open the recorder UI
- **AC-001.2:** User can click through their app while recorder captures interactions
- **AC-001.3:** Recorder generates deterministic Playwright code without AI
- **AC-001.4:** Generated test code can be edited manually
- **AC-001.5:** No API keys are required for recording

**Test Implementation:** Manual/integration test (not visual regression)

---

### US-002: AI-Assisted Test Generation

**User Story:**
**As a** developer iterating on tests
**I want to** use AI to generate and enhance tests with human approval
**So that** I can fix breakages quickly while maintaining control

**Acceptance Criteria:**
- **AC-002.1:** User can provide a URL and receive an AI-generated test
- **AC-002.2:** User can import OpenAPI specs or user stories
- **AC-002.3:** AI extracts test cases from imported specs
- **AC-002.4:** When a test breaks, AI proposes a fix
- **AC-002.5:** User must review and approve AI-generated code before saving

**Test Implementation:** Manual/integration test (not visual regression)

---

### US-003: Full Autonomous Test Generation (Play Agent)

**User Story:**
**As a** team onboarding a new project
**I want to** automatically generate full test coverage
**So that** I can bootstrap CI testing without manual work

**Acceptance Criteria:**
- **AC-003.1:** One-click starts 9-step pipeline (scan routes → classify app → generate tests → run → fix failures → re-run → report)
- **AC-003.2:** Agent fixes failing tests (up to 3 attempts per test)
- **AC-003.3:** Agent pauses and asks for help only when blocked (missing settings, server offline)
- **AC-003.4:** User can resume agent from where it paused
- **AC-003.5:** Final report shows all generated tests and results

**Test Implementation:** Manual/integration test (not visual regression)

---

### US-004: Multi-Engine Visual Diffing

**User Story:**
**As a** QA engineer
**I want to** choose between multiple diff engines
**So that** I can balance speed vs accuracy based on my needs

**Acceptance Criteria:**
- **AC-004.1:** System supports pixelmatch (pixel-perfect) engine
- **AC-004.2:** System supports SSIM (structural similarity) engine
- **AC-004.3:** System supports Butteraugli (human-perception) engine
- **AC-004.4:** User can select preferred engine in settings
- **AC-004.5:** Diff results show which engine was used

**Test Implementation:** Integration test for settings + visual diff comparison

---

### US-005: Text-Region-Aware Diffing

**User Story:**
**As a** tester dealing with dynamic text
**I want** separate thresholds for text vs non-text regions
**So that** I reduce false positives from cross-OS font rendering

**Acceptance Criteria:**
- **AC-005.1:** OCR detects text regions in screenshots
- **AC-005.2:** System applies separate threshold to text regions
- **AC-005.3:** System applies separate threshold to non-text regions
- **AC-005.4:** User can configure text vs non-text thresholds
- **AC-005.5:** Diff report highlights which regions triggered changes

**Test Implementation:** Integration test for diff engine behavior

---

### US-006: Smart Run (Git Diff Analysis)

**User Story:**
**As a** developer in a large codebase
**I want to** run only tests affected by my code changes
**So that** I minimize test execution time

**Acceptance Criteria:**
- **AC-006.1:** User selects a feature branch (not main/master)
- **AC-006.2:** System compares against default branch via GitHub/GitLab API
- **AC-006.3:** System matches tests to changed files by URL patterns
- **AC-006.4:** System matches tests to changed files by code references
- **AC-006.5:** Only affected tests execute; unchanged tests skipped
- **AC-006.6:** Report shows which tests were skipped and why

**Test Implementation:** Integration test for git analysis logic

---

### US-007: Approval Workflow

**User Story:**
**As a** team lead
**I want to** review visual diffs before they become baselines
**So that** I can catch regressions and approve intentional changes

**Acceptance Criteria:**
- **AC-007.1:** System displays side-by-side before/after screenshots
- **AC-007.2:** User can approve individual screenshot changes
- **AC-007.3:** User can reject individual screenshot changes
- **AC-007.4:** Approved screenshots become new baselines
- **AC-007.5:** Rejected screenshots trigger test failure
- **AC-007.6:** Batch approve/reject is available for multiple screenshots

**Test Implementation:** Visual regression test for approval UI workflow

---

### US-008: Remote Runners

**User Story:**
**As a** DevOps engineer
**I want to** distribute test execution across remote machines
**So that** I can test on different OS/browsers concurrently

**Acceptance Criteria:**
- **AC-008.1:** User can register a runner in Settings → Runners
- **AC-008.2:** System generates a one-time authentication token
- **AC-008.3:** Remote machine connects to server via WebSocket
- **AC-008.4:** Tests can be dispatched to remote runners
- **AC-008.5:** Remote runner can execute tests and return results
- **AC-008.6:** Remote runner can record new tests
- **AC-008.7:** System reports runner status (online/offline)
- **AC-008.8:** User can configure max parallel tests per runner

**Test Implementation:** Integration test for WebSocket communication + visual test for UI

---

## User Stories from Excalidraw Test Scenarios

### US-009: Move Element Basic (Excalidraw)

**User Story:**
**As a** user of Excalidraw
**I want to** drag an element to a new position
**So that** I can rearrange my canvas layout

**Acceptance Criteria:**
- **AC-009.1:** User can create a rectangle element
- **AC-009.2:** User can select the rectangle with selection tool
- **AC-009.3:** User can drag rectangle to new position
- **AC-009.4:** Rectangle maintains same size after move
- **AC-009.5:** Visual diff confirms position change

**Test Implementation:** ✅ `test-us009-move-element-basic.js`

**Visual Assertions:**
- Screenshot `-02-created.png`: Rectangle at X~275
- Screenshot `-03-moved.png`: Rectangle at X~475 (200px right)
- Size unchanged (150x150)

---

### US-010: Move Binding Arrow (Excalidraw)

**User Story:**
**As a** user of Excalidraw
**I want** arrows to stay connected when I move bound elements
**So that** my diagram relationships are preserved

**Acceptance Criteria:**
- **AC-010.1:** User can create two rectangles
- **AC-010.2:** User can draw arrow connecting both rectangles
- **AC-010.3:** User can move one rectangle
- **AC-010.4:** Arrow endpoint follows moved rectangle
- **AC-010.5:** Arrow maintains connection to both rectangles

**Test Implementation:** ✅ `test-us010-move-binding-arrow.js`

**Visual Assertions:**
- Screenshot `-01-baseline.png`: Arrow horizontal at Y=250
- Screenshot `-02-moved.png`: Arrow start point at Y=400 (150px down)
- Arrow maintains binding to both rectangles
- Arrow angle changed from horizontal to diagonal

---

### US-011: ALT+Drag Duplicate (Excalidraw)

**User Story:**
**As a** user of Excalidraw
**I want to** duplicate elements by ALT+dragging
**So that** I can quickly create copies

**Acceptance Criteria:**
- **AC-011.1:** User can create a rectangle
- **AC-011.2:** User can hold ALT and drag rectangle
- **AC-011.3:** Original rectangle stays in place
- **AC-011.4:** Duplicate appears at new position
- **AC-011.5:** Duplicate is identical in size and style

**Test Implementation:** ✅ `test-us011-alt-drag-duplicate.js`

**Visual Assertions:**
- Screenshot `-01-original.png`: Single rectangle at X~275
- Screenshot `-02-duplicated.png`: Two rectangles - original at X~275, copy at X~475
- Both rectangles identical in size and style

---

### US-012: Rotate Arrow Binding (Excalidraw)

**User Story:**
**As a** user of Excalidraw
**I want** arrows to update when I rotate bound elements
**So that** connections remain visually accurate

**Acceptance Criteria:**
- **AC-012.1:** User can create rectangle with bound arrow
- **AC-012.2:** User can rotate rectangle using rotation handle
- **AC-012.3:** Arrow endpoint follows rotated rectangle edge
- **AC-012.4:** Visual diff confirms arrow angle change

**Test Implementation:** ✅ `test-us012-rotate-arrow-binding.js`

**Visual Assertions:**
- Screenshot `-01-baseline.png`: Arrow horizontal pointing to rectangle left edge
- Screenshot `-02-rotated.png`: Arrow endpoint moved to follow rotated edge
- Rectangle visibly rotated (~45° clockwise)

---

### US-013: Undo Element Creation (Excalidraw)

**User Story:**
**As a** user of Excalidraw
**I want to** undo my last action
**So that** I can correct mistakes

**Acceptance Criteria:**
- **AC-013.1:** User can create an element
- **AC-013.2:** User can press Ctrl+Z to undo
- **AC-013.3:** Element is removed from canvas
- **AC-013.4:** Canvas returns to previous state

**Test Implementation:** ✅ `test-us013-undo-element-creation.js`

**Visual Assertions:**
- Screenshot `-01-empty.png`: Empty canvas
- Screenshot `-02-created.png`: Rectangle present
- Screenshot `-03-undone.png`: Canvas matches `-01-empty.png` (rectangle removed)

---

### US-014: Redo Element Creation (Excalidraw)

**User Story:**
**As a** user of Excalidraw
**I want to** redo an undone action
**So that** I can restore work I removed by mistake

**Acceptance Criteria:**
- **AC-014.1:** User can create and undo an element
- **AC-014.2:** User can press Ctrl+Shift+Z to redo
- **AC-014.3:** Element reappears on canvas
- **AC-014.4:** Visual diff confirms element restoration

**Test Implementation:** ✅ `test-us014-redo-element-creation.js`

**Visual Assertions:**
- Screenshot `-01-undone.png`: Empty canvas after undo
- Screenshot `-02-redone.png`: Rectangle restored (matches original created state)

---

## Test Files Created

All test files follow the required function signature and are located in `/home/ewyct/dev/lastest2/tests/visual/`:

1. **test-us009-move-element-basic.js** - Tests basic element drag operation
2. **test-us010-move-binding-arrow.js** - Tests arrow binding preservation during move
3. **test-us011-alt-drag-duplicate.js** - Tests ALT+drag duplication
4. **test-us012-rotate-arrow-binding.js** - Tests arrow binding during rotation
5. **test-us013-undo-element-creation.js** - Tests undo functionality
6. **test-us014-redo-element-creation.js** - Tests redo functionality

---

## Test Execution

Each test file exports an async function with the signature:

```javascript
export async function test(page, baseUrl, screenshotPath, stepLogger)
```

**Parameters:**
- `page` - Playwright Page object
- `baseUrl` - Application URL (e.g., `https://excalidraw.com/`)
- `screenshotPath` - Base path for saving screenshots
- `stepLogger` - Logger object with `.log(message)` method

**Screenshot Naming Convention:**
- `{screenshotPath}-{step-number}-{description}.png`
- Example: `test-us009-02-created.png`, `test-us009-03-moved.png`

---

## Coverage Summary

| Category | Total Stories | Visual Tests Created | Coverage |
|----------|--------------|---------------------|----------|
| Lastest2 Core Features | 8 | 0 | 0% (require integration tests) |
| Excalidraw Scenarios | 6 | 6 | 100% |
| **Total** | **14** | **6** | **43%** |

**Note:** The Lastest2 core features (US-001 through US-008) are better suited for integration or E2E tests rather than pure visual regression tests. The Excalidraw scenarios (US-009 through US-014) are ideal for visual regression testing as they verify visual changes to canvas elements.

---

## Additional Recommendations

### Future User Stories to Extract

The documentation suggests additional implicit user stories that could be formalized:

1. **Branch Baseline Management** - "Fork baselines per branch, merge back on PR merge"
2. **Burst Capture Stability** - "Take N screenshots and compare for stability before saving"
3. **Auto-Mask Dynamic Content** - "Automatically detect and mask timestamps, UUIDs, relative times"
4. **Figma Import** - "Import Figma design exports as planned screenshots"
5. **GitHub Action Integration** - "Run visual tests via reusable GitHub Action"
6. **Google Sheets Data Source** - "Use spreadsheet data as test data sources"

### Test Improvements

To make the Excalidraw tests more robust:

1. **Add explicit waits** for animation completion (current tests use fixed 200-500ms waits)
2. **Add element count assertions** (e.g., verify 2 rectangles exist after duplication)
3. **Add position/size assertions** using Excalidraw's internal state API
4. **Add accessibility checks** using axe-core integration
5. **Parameterize coordinates** for easier maintenance

### Selector Recommendations

The tests currently use `data-testid` selectors (best practice). If Excalidraw doesn't provide these, consider:

1. Using `aria-label` attributes
2. Using `role` attributes
3. Falling back to CSS selectors as last resort
4. Requesting upstream `data-testid` additions to Excalidraw

---

## Document Metadata

- **Created:** 2026-03-05
- **Source Documents:**
  - README.md
  - docs/battlecard.md
  - docs/competitive-brief.md
  - docs/competitive-landscape-deep-dive.md
  - docs/excalidraw-test-scenarios.md
- **Test Framework:** Playwright
- **Target Application:** Excalidraw (https://excalidraw.com/)
