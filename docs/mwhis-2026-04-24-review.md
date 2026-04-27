# mwhis review — 2026-04-24

Source: `Lastest 2026-04-24 review - mwhis.docx` (customer mwhospital,
testing on `mwhospital.asseco-mo.hu`). Recorded against v1.10/v1.11 era —
several items are already resolved by the **Criteria** redesign.

This doc has two sections:

1. **Customer replies (Hungarian)** — drafts to send back, item-by-item
2. **Development plan** — what we agreed to build, scoped P0 → P2

---

## 1. Customer replies (Hungarian drafts)

> Háttér: a soft/hard kapcsoló kikerült a Stepekből. Most minden
> assertion **soft** a tesztkódban (continue-on-fail), és a **Criteria**
> fülön döntöd el, hogy egy step változása vagy egy assertion bukása
> mikor jelent **hard failt**. Ez azért jobb, mert így egy futásban
> végig lefutnak a stepek és látod az összes problémát egyszerre, de
> egy gombbal eldöntheted, mi az, ami valóban "elbuktatja" a tesztet.

---

### #1 — Test / Overrides globális-e?

A *Settings* a teljes repo alapértékeit állítja. **Tesztenként** a
*Test → Overrides* fülön (Playwright + Diff) felülírhatóak ezek az értékek
csak az adott tesztre. Ha valamit nem látsz tesztszinten, szólj — szabadon
bővíthetjük.

---

### #2 — "Expected element to be visible" miért sárga?

A sárga banner azt jelzi, hogy soft assertion volt és nem teljesült, de
a teszt mégis átment, mert a **Criteria** fülön nincs olyan szabály, ami
ezt hard fail-lé léptetné. Ha azt szeretnéd, hogy ez a konkrét assertion
buktassa a tesztet, jelöld be a *Test → Criteria → Assertions* szekcióban
az adott assertion sorát ("Fail if … failed"). Onnantól kezdve piros lesz
és failed a run.

---

### #3 — Soft/hard mentés

Ezt áttettük a **Criteria** fülre, és ott a checkbox változás **azonnal,
külön Save nélkül mentődik** (autosave). A Stepekből szándékosan kivettük,
hogy egy helyen legyen a teszt pass/fail logikája. Próbáld ki — ha valahol
mégis kell még Save gomb, jelezd.

---

### #4 — Test / Versions diffelés

Most még csak listázás van, de **berakjuk a verziók közti kódd diffet**
(side-by-side).

---

### #5 — Nincs visual diff data, pedig feltöltöttem screenshotot

Ez összefügg #19 / #22-vel — válaszunk lent.

---

### #6 — Assert step sárga, mert sikertelen volt?

Igen — a sárga = soft, és a step mellett zöld pipa marad, mert nincs
Criteria-szabály, ami ezt hard fail-lé tenné. Pl. ha a screenshot az
előző baselinehez képest változott, akkor a *Test → Criteria → Screenshots*
fülön bekapcsolod a "Fail if {stepLabel} changed" sort, és onnantól a
diff buktatja a tesztet.

---

### #7 — Test Code save után régi tartalom marad refresh-ig

Ez bug, javítjuk — a save után az editor state-jét is frissítjük az új
DB értékkel.

---

### #8 — Direkt elrontott playwright kód is passed lett (hard assert volt)

Eddig egyetlen sikerkritériuma volt a teszteknek - hogy minden screenshot elkészüljön (mert a visual diff volt a prio). Most a criteriaval átállítom h erre is bukjon és configolható legyen.
Összefügg #16 / #24-gyel. 

---

### #9 — Generate test description ékezetes karakterek

Bug, javítjuk — valahol a slug-normalizálás ráfut a megjelenített szövegre is.
A tárolt slug (URL) maradjon ASCII, de a leírás megőrzi az UTF-8 karaktereket.

---

### #10 — Activity feed Reconnecting agent leállás után

Ismert, javítjuk — az embedded browser viewer mostantól megkapja a
session-end signalt és "Session ended" állapotra vált, nem reconnect loopba.

---

### #11 — Generate végtelen homokóra, ha nem találja a menüpontot

Szándékos volt, hogy nagy teszteket ne fogjon meg a max-step, megnézem mit tehetünk.

---

### #12 — Teszt lista táblanézet (last run, last modified, area, sort)

Egyetértünk, jön — toggle a kártyás és táblás nézet közt, sortolható
oszlopokkal.

---

### #13 — Repo-szintű custom test-id attribute (data-automation-id)

Most a *Settings → Playwright → Selector Priority* listában a `data-testid`
az alapértelmezett első helyen, de **custom attribútumot most még nem lehet
beállítani** ott — a per-prompt megoldás (amit Te használsz) működik. Bevezetünk
egy "Custom test-id attribute" mezőt repo-szinten (pl. `data-automation-id`),
amit a recorder, a fallback locator és az AI test-gen prompt is használni
fog. P1 prioritáson tervezve.

---

### #14 — Hónap visszaállítást a teszt végén

Igen, szándékos — a generálási agent megpróbálja visszaállítani az alkalmazást
a kiindulási állapotba, hogy a teszt önálló (idempotens) legyen. Ha ezt nem
szeretnéd, a Generate prompt végén írd: *"Do not revert state at the end."*
Erre csinálunk dokumentációt + egy opcionális checkboxot.

---

### #15 — Miért minden assertion soft?

**Szándékos**, és nem fogjuk hard-ra változtatni az alapot. A logika:

- A tesztkódban minden `expect(...)` soft → így egy futásban végig lefut
  a teszt, és az **összes** problémát egyszerre látod (nem áll meg az elsőnél).
- A *Test → Criteria* fülön egyetlen kattintással eldöntheted, melyik
  assertion / screenshot / console error legyen igazi hard fail.
- A "Fail the test if all steps can't be executed" szabály mindig aktív,
  azaz egy futási hiba (runtime error) **mindig** failed-et eredményez.

Ezt kommunikációban kiemeljük majd jobban — egyetértünk, hogy elsőre
furcsa, hogy soft. A Criteria fül a "kapcsolóterem".

---

### #16 — "is not a function" mégis Passed (test 77beae8e)

Ez ugyanaz a gyökérok, mint #8 / #24. **Bug, P0-n javítjuk**: ha a tesztkód
runtime exceptiont dob (TypeError, ReferenceError stb.), a futásnak failed-nek
kell lennie — most a soft-wrap rétegen át silent warningként esik át.

---

### #17 — Validáció a generált scriptre

Egyetértünk: `tsc --noEmit` (vagy esbuild parse) szintaxisellenőrzést
hozzáadunk az AI által generált Playwright kód mentése előtt — ha hibás,
megpróbáljuk auto-javítani vagy figyelmeztetünk.

---

### #18 — Soft assertion komment vs. kód eltérés

Ez a Steps-fülre vonatkozott; a soft/hard most már nem a kódban dől el,
hanem a **Criteria** fülön (lásd #15). A komment-vs-kód eltérés a régi
modellben volt, mostantól a kód mindig egységes (mind soft `expect(...)`),
és a hard döntést a Criteria szabály hozza meg.

---

### #19 — Visual diff automatikusan?

Egyszerűsítjük: **a Plans-t lényegében nem kell használnod**. A baseline-ok
a futásokból jönnek létre, és a Runs / Build oldalakon vannak a diffek
egy gombnyira. Konkrétan:

- A Run/Build oldalon a **Approve All / Promote latest as baseline** gomb
  egy kattintással baseline-ná teszi a futás összes screenshotját.
- A "No visual data for this run" üzenetet javítjuk, hogy egyértelmű
  legyen: a teszt nem készített screenshotot ebben a futásban (nincs
  Screenshot step). Adj hozzá egy Screenshot stepet vagy a generálás
  automatikusan rakjon be assertion-előtti pillanatképet — és onnantól
  diffel.

Mellékesen: tervben van egy **per-test diff nézet** is csinálok.

---

### #20 — Plans UI nem frissül F5 nélkül

A **Plans / Screenshots** funkciót mostanában mergeltük; lásd #19 — ezt
a usecase-t a Runs / Build flow váltja fel. Ha mégis használnád, javítjuk
a frissítést, de őszintén: a Plans oldalra **nem kell járnod**, a Runs
fül a tényleges baseline / diff eszköz.

---

### #21 — "Last successful run baseline-ná tétele" gomb

**Már létezik!** A Build oldalon (`/builds/<id>`) van egy *Approve All*
gomb, ami az összes diffet jóváhagyja és ezzel az aktuális screenshotok
lesznek a baseline-ok. Egy kattintás. Ha a teszt-szintű "promote latest"
gombot szeretnéd, az is jön — közvetlenül a History fülre.

---

### #22 — Plans match → nem hasonlít össze

Lásd #19 / #20: a Plans-t a Runs flow váltja, baselineokat ne kézzel
töltögess fel — futtasd a tesztet, és a futás screenshotjai lesznek a
baselinek (Approve All). Ha továbbra is van olyan eset, ahol kézi
baseline kellene, mutasd meg, mert lehet, hogy elkerülte a figyelmünket.

---

### #23 — Helper functions minden tesztben fixen

Igen, minden tesztben ott vannak a runner által biztosított helper-ek
(locator fallback, screenshotPath, stb.) — collapsed alapból, hogy ne
zavarjanak. **Ne módosítsd őket**, a teszt-specifikus rész alattuk
található. Tesszük rá az infó-tooltipet, hogy egyértelmű legyen.

---

### #24 — Kézzel elrontott teszt is Passed

Ugyanaz, mint #8 / #16 — egy ticket alá vonjuk és P0-n javítjuk.

---

### #25 — MCP szerver, honnan hozta a repókat?

Az MCP szerver a Bearer tokenedhez kötött team `repositories` tábláját
használja — csak az általad látható repókat hozza. A wiki útmutató
[itt](https://github.com/las-team/lastest/wiki/MCP-Server) — átnézzük
és ha nem világos, kiegészítjük egy "happy path" példával.

---

### #26 — Self-hosted GitLab build integráció

Netről látható a gitlabotok? Lastest is selfhostoljátok esetleg?

1. **Lastest GitLab MR-comment integráció** (self-hosted GitLab támogatott,
   OAuth-csatlakozás után automatikus PR/MR komment).
2. **GitLab CI job**, ami a Lastest API-t hívja vagy a runner CLI-t
   (`@lastest/runner`) telepíti és futtatja. Ehhez csinálunk egy
   `.gitlab-ci.yml` template-et a következő release-ben.

Szívesen segítünk az első yaml-ben — küldj egy 5-soros CI vázat amit
most használtok és átalakítjuk. Nézd meg ha gondolod a github action templatet, ugyanarra lesz szükség kb. Amint megnyomod az add-ot mutatja a paramétereket.

---

## 2. Development plan

### What's already done (verified in code)

| Item | Status | Verified at |
|------|--------|-------------|
| #3 — soft/hard autosave (now Criteria) | ✅ Done | `src/components/tests/step-criteria-tab.tsx:124-131,165-172,203-210` |
| #15 — keep soft default + Criteria gate | ✅ Done | `success-criteria-tab.tsx:197`, evaluation in `src/server/actions/builds.ts:991-1009` |
| #18 — separate soft/hard from code | ✅ Done by Criteria redesign | same as #15 |
| #21 — promote run baselines (build-level) | ✅ Done | `src/app/(app)/builds/[buildId]/build-actions-client.tsx:5,26` |
| Plans / screenshots merged | ✅ Done | (per user note — defer Plans UI fixes) |

**Comms task:** highlight the Criteria tab in the docs / onboarding —
multiple customer questions trace back to "I didn't know Criteria
controls pass/fail."

### P0 — runtime errors silently passing (item #8 / #16 / #24)

**Root cause (verified):** `packages/runner/src/runner.ts:934-938` wraps
**every** standalone `await` in try/catch. Only errors flagged with
`__hardAssertion = true` re-throw. Nothing currently sets that flag, so
TypeErrors (`expect(...).toHaveValue is not a function`) become soft
warnings → status stays `passed`.

**Always-on rule mismatch:** the Criteria tab claims *"Fail the test if
all steps can't be executed — always enforced"* (`step-criteria-tab.tsx:241`),
but `src/lib/execution/evaluation.ts` does **not** enforce this. The runner
records `lastReachedStep` and `totalSteps` (`runner.ts:594, 925-926`),
they're persisted in `test_results` (`builds.ts:606,631`), but nothing
compares them.

**Fix plan:**

1. **Distinguish runtime errors from assertion failures** in the
   soft-wrap. Detect `TypeError`, `ReferenceError`, `SyntaxError` classes
   (or `error instanceof TypeError`) and re-throw — only catch real
   Playwright assertion errors.
2. **Enforce the always-on rule in `evaluation.ts`**: if
   `lastReachedStep + 1 < totalSteps`, override status to `failed` with
   reason `"Test stopped at step N of M"`. This catches anything the
   runtime-error filter misses.
3. **Verify on the two real cases** the customer reported:
   - `https://app.lastest.cloud/tests?test=77beae8e-4754-4809-9b13-2313ff4524e2`
   - `https://app.lastest.cloud/tests?test=db03565f-7df9-4f2e-a8e0-de4ba7a5a10f`
4. Add a unit test in `src/lib/execution/evaluation.test.ts` for the
   `lastReachedStep < totalSteps` branch, and a runner-level test for
   TypeError propagation.

**Owner:** TBD — touches both `packages/runner/src/runner.ts` and
`src/lib/execution/evaluation.ts`. Bump runner version after.

### P1 — implement

- **#4 — Versions diff viewer.** Side-by-side Monaco DiffEditor on the
  *Versions* tab, between adjacent rows of `test_versions`. New file
  `src/components/tests/version-diff-dialog.tsx`. Lightweight; no schema
  change.
- **#11 — Agent infinite hourglass.** Add max-iteration guard +
  heartbeat timeout in `src/server/actions/play-agent.ts`. On exhaustion,
  end the session with a clear error event so the activity feed surfaces
  the failure.
- **#13 — Custom test-id attribute (repo setting).**
  - Schema: add `customAttributeName: text` column to `playwright_settings`
    (default null).
  - Schema: extend `SelectorType` with `'custom-attr'`. Update
    `DEFAULT_SELECTOR_PRIORITY` to insert it at priority 0 when set.
  - Wire into `src/lib/selector-recommendations.ts`, the recorder, and
    the AI test-gen system prompt (`customInstructions` injection).
  - UI: input field in `src/components/settings/playwright-settings-card.tsx`.
- **#17 — Generated-script validation.** After `play-agent` writes test
  code, run it through `esbuild.transform({ loader: 'ts' })` (parse-only)
  before persisting. On parse error, attempt one auto-repair pass; if
  that fails, surface a UI warning and keep the previous code.
- **#19 — Per-test diff view.** New section on the test detail *History*
  tab that shows the latest run's diffs inline (Approved / Rejected
  buttons per diff), without needing to navigate to the build page.
- **#21 (test-level extension)** — "Promote latest run as baseline"
  button on the test detail *History* tab. Server action wraps the
  existing `approveAllDiffs` logic but scoped to `testResultId`.
- **#26 — `.gitlab-ci.yml` template** for the GitLab runner integration.
  Drop in `examples/` and link from docs.

### P2 — UX polish

- **#2 / #6 / #23 — Tooltips & empty-state copy.** Sárga banner: "Soft
  assertion did not pass — no Criteria rule promotes this to a hard
  fail". "No visual diff data": "No screenshots in this run — add a
  Screenshot step." Helper-region tooltip: "Standard helpers managed
  by Lastest, do not edit."
- **#7 — Editor stale-after-save.** After `revalidatePath`, force the
  Monaco editor to re-read the form value (controlled value or remount).
- **#9 — Hungarian characters in Generate description.** Find the
  `slugify`/`normalize` call hitting the display text, scope it to the
  slug only.
- **#10 — Embedded viewer reconnect loop after agent end.** Emit
  terminal WS event on `agent_sessions.endedAt`; client switches to
  "Session ended".
- **#12 — Tests page table view toggle.** New `tests-table-view.tsx`
  rendered next to the existing card view; columns: status, last run,
  last modified, area; sortable.
- **#14 — Generate "restore state at end" checkbox.** Optional toggle
  on the Generate dialog (default on); maps to a flag in the agent
  prompt.
- **#19 — Better empty-state copy** on Run History when no screenshots.
- **#25 — MCP "happy path" doc.** One-pager linked from the wiki:
  install → token → list repos → first test.

### Comms / no code change

- **#1, #14, #25, #26 (already-supported parts)** — reply only.
- **#15** — keep behavior, update onboarding/help copy: *"All assertions
  are soft by design — promote them to hard fails on the Criteria tab."*

---

## Open questions before starting

1. For #13 (custom test-id attribute), should it **replace** `data-testid`
   in priority order, or **add to** it as priority 0 (preferred but fall
   back to `data-testid` if absent)? Default plan: add to as priority 0.
2. For P0, do we want to also surface a **"Promote runtime errors to
   fail"** read-only row in the Criteria tab so users can see the rule
   is now actually enforced? (Cosmetic but matches the always-on rule
   currently shown.)
3. Plans page: leave as-is in maintenance mode, or hide entirely behind
   a feature flag now that baselines flow through Runs?
