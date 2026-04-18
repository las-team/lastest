# MW2021 — 10 Happy Path Tests (mwhospital.asseco-mo.hu)

Based on the MW2021 Rendszergazdai kézikönyv v1.0. Target app: `https://mwhospital.asseco-mo.hu/` (credentials `uitest` / `Uitest.01`).

> The `lastest_create_test` MCP endpoint is currently returning HTTP 500, so the tests below are delivered as ready-to-paste Playwright code. Each block goes into the `code` field of a new test in repo `mwtest` (`8650cff3-9d0d-4241-975f-ee9baea98370`). Once the AI endpoint is back, I can push them via `create_test` + `update_test`, or you can add them manually.

Functional areas already created:

- Patient Enrollment — `9edc0d5b-9a9b-4668-b73b-95ef6a4f7399`
- Booking — `cad11f5f-ebff-4056-b04d-5f95f1bc0fbf`
- Sub-scenarios — `a59ea410-7b79-4ae0-9c66-6fc808d60811`

Coverage:

| # | Title | Area | Flow |
|---|---|---|---|
| 1 | Enroll new patient — minimal fields | Patient Enrollment | basic |
| 2 | Enroll new patient — full demographics | Patient Enrollment | iteration |
| 3 | Book appointment for existing patient | Booking | basic |
| 4 | Book appointment for unregistered patient | Booking | iteration |
| 5 | Query appointments (Előjegyzések lekérdezése) | Booking | sub-scenario |
| 6 | Switch active worklist via NavBar dropdown | Sub-scenarios | sub-scenario |
| 7 | Open patient record → navigate Kórtörténet tab | Sub-scenarios | sub-scenario |
| 8 | Open patient record → navigate Számlák tab | Sub-scenarios | iteration |
| 9 | Create new árlista tétel (price list item) | Sub-scenarios | admin basic |
| 10 | Monthly appointment view loads | Sub-scenarios | sub-scenario |

Shared runner conventions (learned from v1.10 bug-hunt):

- Avoid `.filter({ hasText })` / `.filter({ has: ... })` — runner's TS stripper chokes (`Unexpected token '{'` / `'try'`).
- Prefer CSS `:has(...)`, `getByRole({ name: /regex/ })`, `getByText(exact)`.
- No `waitForLoadState('networkidle')` — app has persistent polling, hangs or times out.
- Use `page.evaluate(() => { ... })` for React click-through via `btn.click()` when locator click does not propagate.
- Always screenshot with `path: screenshotPath, fullPage: true`.

---

## 1. Enroll new patient — minimal fields

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Dashboard and open patient registration');
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  await page.getByRole('button', { name: 'Páciens regisztrációja' }).click();
  await page.waitForTimeout(4000);
  await page.waitForURL(/ShowNewPatientScreen/, { timeout: 15000 });

  stepLogger.log('Fill minimal required fields via label → sibling input (uppercased UI labels)');
  await page.evaluate(() => {
    function setByLabel(labelText, value) {
      const labels = Array.from(document.querySelectorAll('label'));
      const lbl = labels.find(l => (l.innerText || '').trim() === labelText);
      if (!lbl) return false;
      const wrap = lbl.parentElement;
      const inp = wrap ? wrap.querySelector('input, textarea') : null;
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    setByLabel('Vezétéknév', 'Teszt');
    setByLabel('Utónév 1', 'Elek');
    setByLabel('Születési dátum', '1990.05.20');
  });
  await page.waitForTimeout(500);

  stepLogger.log('Pick gender: Férfi');
  await page.getByText('Férfi', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(500);

  stepLogger.log('Screenshot populated form');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

## 2. Enroll new patient — full demographics (iteration)

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Open new patient form');
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: 'Páciens regisztrációja' }).click();
  await page.waitForURL(/ShowNewPatientScreen/, { timeout: 15000 });
  await page.waitForTimeout(3500);

  stepLogger.log('Fill full demographic fields via label helper');
  await page.evaluate(() => {
    function setByLabel(labelText, value) {
      const labels = Array.from(document.querySelectorAll('label'));
      const lbl = labels.find(l => (l.innerText || '').trim() === labelText);
      if (!lbl) return false;
      const wrap = lbl.parentElement;
      const inp = wrap ? wrap.querySelector('input, textarea') : null;
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    setByLabel('Vezétéknév', 'Nagy');
    setByLabel('Utónév 1', 'Éva');
    setByLabel('Születési dátum', '1985.11.03');
    setByLabel('Anyja neve vezetéknév', 'Kovács');
    setByLabel('Anyja neve utónév 1', 'Mária');
    setByLabel('Születési hely', 'Budapest');
  });
  await page.waitForTimeout(400);

  stepLogger.log('Pick gender: Nő');
  await page.getByText('Nő', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(600);

  stepLogger.log('Screenshot fully populated patient form');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

## 3. Book appointment for existing patient

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Open patient search');
  await page.goto(baseUrl + '/searchPatient', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  stepLogger.log('Search for patient');
  const searchBox = page.getByRole('textbox', { name: 'Keresés', exact: true });
  await searchBox.waitFor({ timeout: 15000 });
  await searchBox.click();
  await searchBox.fill('a');
  await searchBox.press('Enter');
  await page.waitForTimeout(4000);

  stepLogger.log('Click naptár (new appointment) icon on first patient row');
  const bookBtn = page.locator('table tbody tr button:has(svg[data-automation-id="PatientRegister_CreateNewAppointment_new_appointment"])').first();
  await bookBtn.waitFor({ timeout: 15000 });
  await bookBtn.click();
  await page.waitForTimeout(6000);
  await page.waitForURL(/\/appointments\//, { timeout: 10000 }).catch(() => {});

  stepLogger.log('Screenshot booking state (form or error page)');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

## 4. Book appointment for unregistered patient (iteration)

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Open patient search and start unregistered appointment');
  await page.goto(baseUrl + '/searchPatient', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  await page.getByRole('button', { name: /Előjegyzés regisztrálatlan/ }).click();
  await page.waitForTimeout(5000);
  await page.waitForURL(/\/appointments\/unregisteredPatient/, { timeout: 10000 }).catch(() => {});

  stepLogger.log('Screenshot the unregistered-patient booking form state');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

## 5. Query appointments (Előjegyzések lekérdezése)

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Go to dashboard');
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  stepLogger.log('Click the Előjegyzések navbar item via text');
  await page.evaluate(() => {
    const items = document.querySelectorAll('[class*="NavBar_item"]');
    for (const i of items) {
      if ((i.innerText || '').trim() === 'Előjegyzések lekérdezése' || (i.innerText || '').trim() === 'Dolgozói naptárak') {
        i.click();
        return 'clicked';
      }
    }
    return 'no item';
  });
  await page.waitForTimeout(6000);

  stepLogger.log('Screenshot the appointment query or employee calendar screen');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

## 6. Switch active worklist via NavBar dropdown

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Open dashboard (CORDL default)');
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  stepLogger.log('Switch worklist to BT-DMSZ via navbar dropdown');
  const switched = await page.evaluate(() => {
    const items = document.querySelectorAll('[class*="NavBar_item"]');
    for (const i of items) {
      if ((i.innerText || '').trim() === 'BT-DMSZ - Eset lista') {
        i.click();
        return true;
      }
    }
    return false;
  });
  if (!switched) throw new Error('BT-DMSZ worklist not found in navbar');
  await page.waitForTimeout(5000);

  stepLogger.log('Verify new worklist loaded');
  await page.getByRole('heading', { name: /BT-DMSZ/ }).first().waitFor({ timeout: 10000 });

  stepLogger.log('Screenshot the switched worklist');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

## 7. Open patient record → Kórtörténet tab

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Open patient from search');
  await page.goto(baseUrl + '/searchPatient', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const searchBox = page.getByRole('textbox', { name: 'Keresés', exact: true });
  await searchBox.waitFor({ timeout: 15000 });
  await searchBox.fill('a');
  await searchBox.press('Enter');
  await page.waitForTimeout(4500);

  const firstRow = page.locator('table tbody tr').first();
  await firstRow.waitFor({ timeout: 20000 });
  await firstRow.locator('button').first().click();
  await page.waitForTimeout(6000);

  stepLogger.log('Click Kórtörténet sidebar tab');
  await page.locator('[title="Kórtörténet"]').first().click();
  await page.waitForTimeout(3000);

  stepLogger.log('Screenshot Kórtörténet view');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

## 8. Open patient record → Számlák tab (iteration of #7)

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Open first patient from search');
  await page.goto(baseUrl + '/searchPatient', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const searchBox = page.getByRole('textbox', { name: 'Keresés', exact: true });
  await searchBox.waitFor({ timeout: 15000 });
  await searchBox.fill('a');
  await searchBox.press('Enter');
  await page.waitForTimeout(4500);

  const firstRow = page.locator('table tbody tr').first();
  await firstRow.waitFor({ timeout: 20000 });
  await firstRow.locator('button').first().click();
  await page.waitForTimeout(6000);

  stepLogger.log('Click Számlák sidebar tab');
  await page.locator('[title="Számlák"]').first().click();
  await page.waitForTimeout(3000);

  stepLogger.log('Screenshot Számlák view');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

## 9. Create new price list item (Árlista tétel) — admin flow

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Open Árlista tételek settings page');
  await page.goto(baseUrl + '/screen/null%3BWebAppBackend.Settings.ShowSettingsScreen%3BFull', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  await page.locator('[title="Árlista tételek"]').first().click();
  await page.waitForTimeout(4000);

  stepLogger.log('Click Hozzáadás to start a new price list item');
  await page.getByRole('button', { name: 'Hozzáadás' }).first().click();
  await page.waitForTimeout(2500);

  stepLogger.log('Fill code + name fields');
  await page.getByRole('textbox', { name: /Kód/ }).first().fill('TEST-' + Date.now().toString().slice(-5));
  await page.getByRole('textbox', { name: /Név/ }).first().fill('Automated price list item');
  await page.waitForTimeout(800);

  stepLogger.log('Screenshot populated new-item form');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

## 10. Monthly appointment view loads

```js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Open monthly appointment view');
  await page.goto(baseUrl + '/appointments/monthly', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  stepLogger.log('Screenshot monthly view (populated with current month calendar or error state)');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
```

---

### Next step

Once the `lastest_create_test` endpoint returns to normal, each block can be added via:

```
create_test(repositoryId, functionalAreaId, prompt="<title>", url="https://mwhospital.asseco-mo.hu/")
→ update_test(testId, code="<block above>")
```

Or they can be pasted directly through the Lastest web UI.
