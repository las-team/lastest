# Excalidraw Test Scenarios - Step-by-Step

## Suite 1: Move Tests

### Test 1: Move Element Basic
**Purpose:** Verify element position updates correctly after drag operation

| Step | Action | Expected Result | Screenshot |
|------|--------|-----------------|------------|
| 1 | Navigate to `https://excalidraw.com/` | Canvas loads | `01-initial.png` |
| 2 | Click rectangle tool (`[data-testid="toolbar-rectangle"]`) | Rectangle tool selected |
| 3 | Mouse down at (200, 200) | Start drawing |
| 4 | Mouse move to (350, 350) | Rectangle preview visible |
| 5 | Mouse up | Rectangle created (150x150) | `02-created.png` |
| 6 | Click selection tool (`[data-testid="toolbar-selection"]`) | Selection tool active |
| 7 | Click center of rectangle (275, 275) | Rectangle selected |
| 8 | Mouse down at (275, 275) | Start drag |
| 9 | Mouse move to (475, 275) | Rectangle moves right 200px |
| 10 | Mouse up | Rectangle at new position | `03-moved.png` |

**Visual Assertions:**
- Screenshot 2 vs 3: Rectangle center X changed from ~275 to ~475
- Rectangle maintains same size (150x150)

---

### Test 2: Move Binding Arrow
**Purpose:** Verify arrow endpoint updates when connected rectangle moves

| Step | Action | Expected Result | Screenshot |
|------|--------|-----------------|------------|
| 1 | Navigate to `https://excalidraw.com/` | Canvas loads |
| 2 | Click rectangle tool | Rectangle tool selected |
| 3 | Draw rectangle at (100,200) to (200,300) | First rectangle (100x100) |
| 4 | Draw rectangle at (400,200) to (500,300) | Second rectangle (100x100) |
| 5 | Click arrow tool (`[data-testid="toolbar-arrow"]`) | Arrow tool selected |
| 6 | Mouse down at (200, 250) - right edge of rect 1 | Start arrow |
| 7 | Mouse move to (400, 250) - left edge of rect 2 | Arrow connects both rectangles |
| 8 | Mouse up | Arrow binds to both rectangles | `01-baseline.png` |
| 9 | Click selection tool | Selection tool active |
| 10 | Click first rectangle center (150, 250) | Rectangle 1 selected |
| 11 | Mouse down at (150, 250) | Start drag |
| 12 | Mouse move to (150, 400) | Rectangle moves down 150px |
| 13 | Mouse up | Arrow endpoint follows rectangle | `02-moved.png` |

**Visual Assertions:**
- Screenshot 1 vs 2: Arrow start point moved from Y=250 to Y=400
- Arrow maintains connection to both rectangles
- Arrow angle changed from horizontal to diagonal

---

### Test 3: ALT+Drag Duplicate
**Purpose:** Verify ALT+drag creates a copy while preserving original

| Step | Action | Expected Result | Screenshot |
|------|--------|-----------------|------------|
| 1 | Navigate to `https://excalidraw.com/` | Canvas loads |
| 2 | Click rectangle tool | Rectangle tool selected |
| 3 | Draw rectangle at (200,200) to (350,350) | Rectangle created (150x150) | `01-original.png` |
| 4 | Click selection tool | Selection tool active |
| 5 | Click rectangle center (275, 275) | Rectangle selected |
| 6 | Press and hold ALT key | Modifier active |
| 7 | Mouse down at (275, 275) | Start ALT+drag |
| 8 | Mouse move to (475, 275) | Duplicate preview at new position |
| 9 | Mouse up | Duplicate created |
| 10 | Release ALT key | | `02-duplicated.png` |

**Visual Assertions:**
- Screenshot 1: Single rectangle at X~275
- Screenshot 2: Two rectangles - original at X~275, copy at X~475
- Both rectangles identical in size and style

---

## Suite 2: Rotate Tests

### Test 4: Rotate Arrow Binding
**Purpose:** Verify bound arrow updates when target element rotates

| Step | Action | Expected Result | Screenshot |
|------|--------|-----------------|------------|
| 1 | Navigate to `https://excalidraw.com/` | Canvas loads |
| 2 | Click rectangle tool | Rectangle tool selected |
| 3 | Draw rectangle at (300,200) to (450,350) | Rectangle created (150x150) |
| 4 | Click arrow tool | Arrow tool selected |
| 5 | Mouse down at (100, 275) | Start arrow (far left) |
| 6 | Mouse move to (300, 275) | Arrow points to rectangle |
| 7 | Mouse up | Arrow binds to rectangle left edge | `01-baseline.png` |
| 8 | Click selection tool | Selection tool active |
| 9 | Click rectangle center (375, 275) | Rectangle selected with handles |
| 10 | Mouse move to rotation handle (375, 150) | Hover rotation handle (top center) |
| 11 | Mouse down | Start rotation |
| 12 | Mouse move to (475, 200) | Rotate ~45 degrees clockwise |
| 13 | Mouse up | Rectangle rotated | `02-rotated.png` |

**Visual Assertions:**
- Screenshot 1: Arrow horizontal, pointing to rectangle left edge
- Screenshot 2: Arrow endpoint moved to follow rotated rectangle edge
- Rectangle visibly rotated (corners at angles)

---

## Suite 3: History Tests

### Test 5: Undo Element Creation
**Purpose:** Verify Ctrl+Z removes last created element

| Step | Action | Expected Result | Screenshot |
|------|--------|-----------------|------------|
| 1 | Navigate to `https://excalidraw.com/` | Canvas loads | `01-empty.png` |
| 2 | Click rectangle tool | Rectangle tool selected |
| 3 | Draw rectangle at (200,200) to (350,350) | Rectangle created | `02-created.png` |
| 4 | Press Ctrl+Z | Undo command sent |
| 5 | Wait 200ms | Animation completes | `03-undone.png` |

**Visual Assertions:**
- Screenshot 1 (empty) ≈ Screenshot 3 (undone)
- Screenshot 2 shows rectangle that is absent in screenshot 3
- Canvas returns to empty state

---

### Test 6: Redo Element Creation
**Purpose:** Verify Ctrl+Shift+Z restores undone element

| Step | Action | Expected Result | Screenshot |
|------|--------|-----------------|------------|
| 1 | Navigate to `https://excalidraw.com/` | Canvas loads |
| 2 | Click rectangle tool | Rectangle tool selected |
| 3 | Draw rectangle at (200,200) to (350,350) | Rectangle created |
| 4 | Press Ctrl+Z | Rectangle removed | `01-undone.png` |
| 5 | Wait 200ms | Undo completes |
| 6 | Press Ctrl+Shift+Z | Redo command sent |
| 7 | Wait 200ms | Redo completes | `02-redone.png` |

**Visual Assertions:**
- Screenshot 1 (undone): Empty canvas
- Screenshot 2 (redone): Rectangle restored at original position
- Rectangle identical to pre-undo state

---

### Test 7: Undo Multiple Operations
**Purpose:** Verify sequential undo reverts operations in reverse order

| Step | Action | Expected Result | Screenshot |
|------|--------|-----------------|------------|
| 1 | Navigate to `https://excalidraw.com/` | Canvas loads | `01-empty.png` |
| 2 | Click rectangle tool | Rectangle tool selected |
| 3 | Draw rectangle at (200,200) to (350,350) | Rectangle created | `02-created.png` |
| 4 | Click selection tool | Selection tool active |
| 5 | Click rectangle center (275, 275) | Rectangle selected |
| 6 | Drag rectangle to (475, 275) | Rectangle moved right | `03-moved.png` |
| 7 | Press Ctrl+Z | Undo move |
| 8 | Wait 200ms | | `04-undo-move.png` |
| 9 | Press Ctrl+Z | Undo create |
| 10 | Wait 200ms | | `05-undo-create.png` |

**Visual Assertions:**
- Screenshot 2 (created): Rectangle at X~275
- Screenshot 3 (moved): Rectangle at X~475
- Screenshot 4 (undo move): Rectangle back at X~275 (same as screenshot 2)
- Screenshot 5 (undo create): Empty canvas (same as screenshot 1)

---

### Test 8: Undo/Redo Button State
**Purpose:** Verify toolbar button states reflect available history actions

| Step | Action | Expected Result | Screenshot |
|------|--------|-----------------|------------|
| 1 | Navigate to `https://excalidraw.com/` | Canvas loads | `01-initial.png` |
| 2 | Observe undo button | Should be disabled/grayed |
| 3 | Observe redo button | Should be disabled/grayed |
| 4 | Click rectangle tool | Rectangle tool selected |
| 5 | Draw rectangle at (200,200) to (350,350) | Rectangle created | `02-undo-enabled.png` |
| 6 | Observe undo button | Should be enabled/active |
| 7 | Observe redo button | Should be disabled/grayed |
| 8 | Press Ctrl+Z | Undo executed |
| 9 | Wait 200ms | | `03-redo-enabled.png` |
| 10 | Observe undo button | Should be disabled/grayed |
| 11 | Observe redo button | Should be enabled/active |

**Visual Assertions:**
- Screenshot 1: Both undo/redo buttons disabled (visual indicator)
- Screenshot 2: Undo enabled, redo disabled
- Screenshot 3: Undo disabled, redo enabled
- Button states provide visual feedback on available actions

---

## Test Data Summary

| Test | Screenshots | Key Visual Changes |
|------|-------------|-------------------|
| Move Element Basic | 3 | Rectangle X position shift |
| Move Binding Arrow | 2 | Arrow endpoint follows rectangle |
| ALT+Drag Duplicate | 2 | Element count: 1 → 2 |
| Rotate Arrow Binding | 2 | Arrow angle + rectangle rotation |
| Undo Element Creation | 3 | Element appears then disappears |
| Redo Element Creation | 2 | Element reappears |
| Undo Multiple Operations | 5 | Position change + element removal |
| Undo/Redo Button State | 3 | Toolbar button visual states |

**Total Screenshots:** 22
