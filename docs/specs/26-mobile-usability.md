# Feature Spec: Mobile Usability (GA surface)

## Overview

Make the generally-available (non–Early-Adopter) functions usable on phones
(360–430 px). Early-Adopter features (Compose, Compare, Impact, URL Diff — see
`12-early-adopter-mode.md`) are explicitly **out of scope**: they stay
desktop-first and remain hidden from the mobile nav for non-EA teams anyway.

## Functions that must work on mobile

| Function        | Route                | Mobile job-to-be-done                                    |
| --------------- | -------------------- | -------------------------------------------------------- |
| Dashboard       | `/`                  | Glance at health/last build on the go                    |
| Verify (board)  | `/verify/[id]`       | Triage cases: Unsorted → Verified/Broken/Missed          |
| Verify (focus)  | `/verify/[id]`       | Inspect one case, decide OK / Needs improvement / Reject |
| Runs            | `/run`               | Kick off a run, watch progress                           |
| Review / Builds | `/review`, `/builds` | Approve/reject visual diffs                              |
| Tests           | `/tests`             | Browse definitions, open a test                          |
| Leaderboard     | `/leaderboard`       | Check scores (gamification-enabled teams)                |
| Settings        | `/settings`          | Flip team toggles, manage account                        |

The app shell already ships a mobile top bar + bottom nav
(`src/components/layout/mobile-*.tsx`); pages inside it were desktop-only.

## Research: patterns borrowed

- **Trello mobile** — never show a multi-column board on a phone: one list
  full-width, with a segmented control/pager to switch lists (counts visible).
- **Outlook/Spark mail triage & Linear inbox** — act from the card without
  opening it; committal actions get an undo/confirmation affordance.
- **GitHub Mobile** — secondary actions live in bottom sheets, not hover
  menus; keyboard shortcuts have no mobile analog, so every shortcut needs a
  visible button equivalent.
- **Before/after touch sliders** — standard pattern for image comparison on
  touch; wide tables collapse to key-value stacks or scroll horizontally.

## Design

### Verify board (`board-view.tsx`) — Trello-style single column

- `useIsMobile()` (existing hook, &lt; 768 px) switches the board from
  4-columns-side-by-side to **one column at a time** with a segmented
  control (`Unsorted | Missed | Broken | Verified`) that carries per-column
  counts and the column accent color. Default tab: Unsorted.
- Drag-and-drop is pointless with one visible column, so each card gains a
  **mobile-only "move" row**: tap-targets that call the same `onDropCase`
  server path the desktop drag uses (e.g. from Unsorted: ✓ Verified,
  ✗ Broken, ⚠ Missed). Desktop keeps drag as-is.
- **Swipe-to-triage** (mail-app pattern, `use-swipe-triage.ts`): swipe a
  card right → Verified, left → Broken, with a colored backdrop reveal and
  a ~96 px commit threshold. A direction lock (12 px slop, horizontal must
  dominate) plus `touch-action: pan-y` keeps vertical scrolling intact; the
  side matching the card's current column rubber-bands instead of
  committing. Every mobile move — swipe, move row, or review mode — fires
  an **undo toast** that restores the previous column (dropping back on
  Unsorted clears feedback, so undo is lossless).
- **Review mode** (Tinder-style stack): a "Review N unsorted" button under
  the column switcher opens a full-screen card stack for burning down the
  Unsorted queue. Swipe commits the same Verified/Broken decisions (with
  VERIFIED/BROKEN stamps scaling with swipe progress); a pinned button bar
  (Broken · Missed · Skip · Verified) is the visible, accessible fallback.
  Skipped cases drop to the back of the session's queue; a done state
  offers "Review skipped" / "Back to board". Mobile-only — desktop has the
  full board + Focus view for the same job.
- Column bulk actions (Verify all / Report all) stay — they're already
  buttons.

### Verify focus view (`focus-view.tsx`)

- The fixed 260 px case-list sidebar becomes an **overlay drawer** on mobile,
  toggled from a "Cases" button in the toolbar; main compare pane gets the
  full viewport width.
- Evidence tables (network/console: 7 fixed grid columns) get horizontal
  scroll containment instead of overflowing the page.
- The bottom action bar (OK / Needs improvement / Reject) already exists as
  buttons — kept as the mobile replacement for the `e`/`t`/`s` hotkeys.

### Verify chrome (`board-focus-client.tsx`, `verify-index-client.tsx`, CSS)

- Header wraps on narrow viewports instead of forcing one row.
- Filter (320 px) and branch (280 px) dropdowns clamp to
  `min(Npx, calc(100vw - 24px))`.
- Empty-state card `maxWidth: 460` → `min(460px, 100%)`.
- `verify-design.css`: `.v-btn { min-width: 132px }` relaxed under a
  `@media (max-width: 767.98px)` query.

### App shell

- Bottom nav gains a **Verify** tab (badge-free v1) when the team has the
  Verify phase enabled; `Run | Verify | Review | More` — the three core
  mobile jobs plus the drawer.

### Page-level responsive fixes

- `metrics-row.tsx`: Cases `grid-cols-4` → `grid-cols-2 md:grid-cols-4`,
  AI row `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`, Tests/Cases sections
  stack vertically on mobile (divider hidden).
- Settings tabs: horizontally scrollable `TabsList` on mobile.
- Run dashboard: `w-[180px]` select → `w-full sm:w-[180px]`.
- Leaderboard: `text-4xl` header → `text-2xl md:text-4xl`; row gaps/score
  size reduced on mobile so names keep ≥ 40 % of the row.

## Out of scope (follow-ups)

- Recording/EB live-streaming on mobile (desktop-class workflows).
- Early-Adopter pages (Compose, Compare, Impact, URL Diff).
