// playground-registry.ts — VENDORED from lastest-www. Single source of truth is the frontend
// (`lastest-www:src/lib/playground-achievements.ts` + `src/lib/playground.ts`). Regenerate
// (don't hand-edit) whenever the frontend registry changes; retire ids, never re-point them.
// Points = easy 10 / medium 15 / hard 25. Completion bonus per exercise = easy 20 / med 30 / hard 50.
// 75 achievements / 18 exercises / max 1755 (1175 achievement + 580 completion).

/** Every valid achievement id → its point value. Reject/ignore ids not in this map. */
export const ACHIEVEMENT_POINTS: Record<string, number> = {
  "forms.account-created": 10,
  "forms.validation-wall": 10,
  "forms.email-error": 10,
  "forms.strong-password": 10,
  "forms.summary": 10,
  "buttons.single-click": 10,
  "buttons.double-click": 10,
  "buttons.right-click": 10,
  "buttons.moving-click": 10,
  "buttons.covered-click": 10,
  "dropdowns.native-select": 15,
  "dropdowns.multi-select-three": 15,
  "dropdowns.combobox-select": 15,
  "dropdowns.combobox-empty": 15,
  "checkboxes-radios.indeterminate": 10,
  "checkboxes-radios.all-suites": 10,
  "checkboxes-radios.pick-plan": 10,
  "checkboxes-radios.notifications-on": 10,
  "date-picker.native-confirmed": 15,
  "date-picker.calendar-pick": 15,
  "date-picker.check-in": 15,
  "date-picker.range-nights": 15,
  "alerts-dialogs.alert-accepted": 15,
  "alerts-dialogs.confirm-ok": 15,
  "alerts-dialogs.prompt-answered": 15,
  "alerts-dialogs.modal-saved": 15,
  "alerts-dialogs.toast-fired": 15,
  "hover-tooltips.reveal-action": 15,
  "hover-tooltips.js-tooltip": 15,
  "hover-tooltips.menu-leaf": 15,
  "hover-tooltips.context-action": 15,
  "drag-and-drop.first-drop": 25,
  "drag-and-drop.board-complete": 25,
  "drag-and-drop.sorted": 25,
  "drag-and-drop.slider-75": 25,
  "windows-tabs.popup-opened": 15,
  "windows-tabs.code-verified": 15,
  "windows-tabs.delayed-popup": 15,
  "windows-tabs.popup-closed": 15,
  "waits.delayed-element": 15,
  "waits.data-loaded": 15,
  "waits.progress-stop": 15,
  "waits.armed-click": 15,
  "waits.job-done": 15,
  "dynamic-table.checkout-filter": 15,
  "dynamic-table.failed-only": 15,
  "dynamic-table.page-three": 15,
  "dynamic-table.zero-rows": 15,
  "infinite-scroll.needle-35": 15,
  "infinite-scroll.first-batch": 15,
  "infinite-scroll.end-of-feed": 15,
  "infinite-scroll.top-button": 15,
  "upload-download.single-upload": 15,
  "upload-download.oversize-rejected": 15,
  "upload-download.multi-upload": 15,
  "upload-download.dropzone-files": 15,
  "upload-download.generated-report": 15,
  "iframes.frame-submitted": 25,
  "iframes.token-verified": 25,
  "iframes.level2-click": 25,
  "shadow-dom.first-count": 25,
  "shadow-dom.count-five": 25,
  "tricky.dynamic-id": 25,
  "tricky.nbsp-button": 25,
  "tricky.right-submit": 25,
  "tricky.settled-click": 25,
  "tricky.trap-detected": 25,
  "login.signed-in": 10,
  "login.wrong-password": 10,
  "login.locked-out": 10,
  "login.logged-out": 10,
  "cafe.cart-of-three": 15,
  "cafe.promo-applied": 15,
  "cafe.order-placed": 15,
  "cafe.empty-cart-block": 15,
};

/** Per-exercise: hold ALL `ids` → add `bonus` once. Used for points + completedExercises. */
export const EXERCISE_COMPLETION: Record<
  string,
  { ids: string[]; bonus: number }
> = {
  forms: {
    bonus: 20,
    ids: [
      "forms.account-created",
      "forms.validation-wall",
      "forms.email-error",
      "forms.strong-password",
      "forms.summary",
    ],
  },
  buttons: {
    bonus: 20,
    ids: [
      "buttons.single-click",
      "buttons.double-click",
      "buttons.right-click",
      "buttons.moving-click",
      "buttons.covered-click",
    ],
  },
  dropdowns: {
    bonus: 30,
    ids: [
      "dropdowns.native-select",
      "dropdowns.multi-select-three",
      "dropdowns.combobox-select",
      "dropdowns.combobox-empty",
    ],
  },
  "checkboxes-radios": {
    bonus: 20,
    ids: [
      "checkboxes-radios.indeterminate",
      "checkboxes-radios.all-suites",
      "checkboxes-radios.pick-plan",
      "checkboxes-radios.notifications-on",
    ],
  },
  "date-picker": {
    bonus: 30,
    ids: [
      "date-picker.native-confirmed",
      "date-picker.calendar-pick",
      "date-picker.check-in",
      "date-picker.range-nights",
    ],
  },
  "alerts-dialogs": {
    bonus: 30,
    ids: [
      "alerts-dialogs.alert-accepted",
      "alerts-dialogs.confirm-ok",
      "alerts-dialogs.prompt-answered",
      "alerts-dialogs.modal-saved",
      "alerts-dialogs.toast-fired",
    ],
  },
  "hover-tooltips": {
    bonus: 30,
    ids: [
      "hover-tooltips.reveal-action",
      "hover-tooltips.js-tooltip",
      "hover-tooltips.menu-leaf",
      "hover-tooltips.context-action",
    ],
  },
  "drag-and-drop": {
    bonus: 50,
    ids: [
      "drag-and-drop.first-drop",
      "drag-and-drop.board-complete",
      "drag-and-drop.sorted",
      "drag-and-drop.slider-75",
    ],
  },
  "windows-tabs": {
    bonus: 30,
    ids: [
      "windows-tabs.popup-opened",
      "windows-tabs.code-verified",
      "windows-tabs.delayed-popup",
      "windows-tabs.popup-closed",
    ],
  },
  waits: {
    bonus: 30,
    ids: [
      "waits.delayed-element",
      "waits.data-loaded",
      "waits.progress-stop",
      "waits.armed-click",
      "waits.job-done",
    ],
  },
  "dynamic-table": {
    bonus: 30,
    ids: [
      "dynamic-table.checkout-filter",
      "dynamic-table.failed-only",
      "dynamic-table.page-three",
      "dynamic-table.zero-rows",
    ],
  },
  "infinite-scroll": {
    bonus: 30,
    ids: [
      "infinite-scroll.needle-35",
      "infinite-scroll.first-batch",
      "infinite-scroll.end-of-feed",
      "infinite-scroll.top-button",
    ],
  },
  "upload-download": {
    bonus: 30,
    ids: [
      "upload-download.single-upload",
      "upload-download.oversize-rejected",
      "upload-download.multi-upload",
      "upload-download.dropzone-files",
      "upload-download.generated-report",
    ],
  },
  iframes: {
    bonus: 50,
    ids: [
      "iframes.frame-submitted",
      "iframes.token-verified",
      "iframes.level2-click",
    ],
  },
  "shadow-dom": {
    bonus: 50,
    ids: ["shadow-dom.first-count", "shadow-dom.count-five"],
  },
  tricky: {
    bonus: 50,
    ids: [
      "tricky.dynamic-id",
      "tricky.nbsp-button",
      "tricky.right-submit",
      "tricky.settled-click",
      "tricky.trap-detected",
    ],
  },
  login: {
    bonus: 20,
    ids: [
      "login.signed-in",
      "login.wrong-password",
      "login.locked-out",
      "login.logged-out",
    ],
  },
  cafe: {
    bonus: 30,
    ids: [
      "cafe.cart-of-three",
      "cafe.promo-applied",
      "cafe.order-placed",
      "cafe.empty-cart-block",
    ],
  },
};

/** Reference scoring — mirror of lastest-www scoring.tsx `scoreFor()`. */
export function scoreFor(heldIds: Set<string>): {
  points: number;
  completedExercises: number;
} {
  let points = 0,
    completedExercises = 0;
  for (const id of heldIds) points += ACHIEVEMENT_POINTS[id] ?? 0;
  for (const ex of Object.values(EXERCISE_COMPLETION)) {
    if (ex.ids.every((id) => heldIds.has(id))) {
      points += ex.bonus;
      completedExercises++;
    }
  }
  return { points, completedExercises };
}
