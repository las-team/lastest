import { describe, it, expect } from 'vitest';
import { parseSteps, extractTestBody, extractEditableValue, removeInlineLocateWithFallback, removeInlineReplayCursorPath, type DebugStep } from './debug-parser';

function actionStep(code: string): DebugStep {
  return { id: 0, type: 'action', code, label: '', lineStart: 1, lineEnd: 1 };
}

/** Helper: wrap code in test function, parse, return step labels */
function labelsFor(body: string): string[] {
  const wrapped = `export async function test(page, baseUrl, screenshotPath, stepLogger) {\n${body}\n}`;
  const extracted = extractTestBody(wrapped);
  if (!extracted) return [];
  return parseSteps(extracted).map(s => s.label);
}

describe('generateLabel — locateWithFallback', () => {
  it('shows fill value with selector', () => {
    const labels = labelsFor(
      `  await locateWithFallback(page, [{"type":"role-name","value":"role=textbox[name=\\"First Name\\"]"}], 'fill', 'John', null);`
    );
    expect(labels[0]).toBe('Fill textbox "First Name" "John"');
  });

  it('truncates long fill values', () => {
    const labels = labelsFor(
      `  await locateWithFallback(page, [{"type":"text","value":"text=\\"Email\\""}], 'fill', 'this-is-a-very-long-value-exceeding-twenty', null);`
    );
    expect(labels[0]).toContain('Fill "Email"');
    expect(labels[0]).toContain('"this-is-a-very-lo...');
  });

  it('shows selectOption value', () => {
    const labels = labelsFor(
      `  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\\"Country\\"]"}], 'selectOption', 'Canada', null);`
    );
    expect(labels[0]).toBe('Select "Canada" in "Country"');
  });

  it('shows click with role-name selector', () => {
    const labels = labelsFor(
      `  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Save\\"]"}], 'click', null, null);`
    );
    expect(labels[0]).toBe('Click button "Save"');
  });
});

describe('generateLabel — new selector types', () => {
  it('handles data-testid selector', () => {
    const labels = labelsFor(
      `  await locateWithFallback(page, [{"type":"data-testid","value":"[data-testid=\\"submit-btn\\"]"}], 'click', null, null);`
    );
    expect(labels[0]).toBe('Click testid "submit-btn"');
  });

  it('handles aria-label selector', () => {
    const labels = labelsFor(
      `  await locateWithFallback(page, [{"type":"aria-label","value":"[aria-label=\\"Close dialog\\"]"}], 'click', null, null);`
    );
    expect(labels[0]).toBe('Click "Close dialog"');
  });

  it('handles name selector', () => {
    const labels = labelsFor(
      `  await locateWithFallback(page, [{"type":"name","value":"[name=\\"email\\"]"}], 'fill', 'test@example.com', null);`
    );
    expect(labels[0]).toBe('Fill name "email" "test@example.com"');
  });
});

describe('generateLabel — chained Playwright calls', () => {
  it('shows getByTestId target', () => {
    const labels = labelsFor(
      `  await page.getByTestId('save-button').click();`
    );
    expect(labels[0]).toBe('Click testid "save-button"');
  });

  it('shows selectOption value in chained call', () => {
    const labels = labelsFor(
      `  await page.getByRole('combobox', { name: 'Country' }).selectOption('CA');`
    );
    expect(labels[0]).toBe('Select "CA" in combobox "Country"');
  });

  it('shows fill with target and value', () => {
    const labels = labelsFor(
      `  await page.getByLabel('Email').fill('user@test.com');`
    );
    expect(labels[0]).toBe('Fill "Email" "user@test.com"');
  });
});

describe('generateLabel — keyboard actions', () => {
  it('handles keyboard.type with timestamp', () => {
    const labels = labelsFor(
      `  await page.keyboard.type(new Date().toISOString());`
    );
    expect(labels[0]).toBe('Type current timestamp');
  });

  it('handles keyboard.type with string value', () => {
    const labels = labelsFor(
      `  await page.keyboard.type('Hello World');`
    );
    expect(labels[0]).toBe('Type "Hello World"');
  });
});

describe('generateLabel — fallback labels', () => {
  it('shows selector for bare page.locator click', () => {
    const labels = labelsFor(
      `  await page.locator('#submit-btn').click();`
    );
    expect(labels[0]).toBe('Click #submit-btn');
  });

  it('returns generic Click when no selector available', () => {
    const labels = labelsFor(
      `  await page.mouse.click(100, 200);`
    );
    expect(labels[0]).toBe('Click at (100, 200)');
  });
});

describe('extractEditableValue', () => {
  it('returns fill value from locateWithFallback with role-name selector', () => {
    const v = extractEditableValue(actionStep(
      `await locateWithFallback(page, [{"type":"role-name","value":"role=textbox[name=\\"First Name\\"]"}], 'fill', 'John', null);`
    ));
    expect(v).toBe('John');
  });

  it('returns fill value from locateWithFallback with data-testid selector', () => {
    const v = extractEditableValue(actionStep(
      `await locateWithFallback(page, [{"type":"data-testid","value":"[data-testid=\\"email\\"]"}], 'fill', 'a@b.com', null);`
    ));
    expect(v).toBe('a@b.com');
  });

  it('returns selectOption value from locateWithFallback', () => {
    const v = extractEditableValue(actionStep(
      `await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\\"Country\\"]"}], 'selectOption', 'Canada', null);`
    ));
    expect(v).toBe('Canada');
  });

  it('returns value from chained page.locator(...).fill()', () => {
    const v = extractEditableValue(actionStep(
      `await page.locator('#email').fill('user@example.com');`
    ));
    expect(v).toBe('user@example.com');
  });

  it('tolerates trailing options argument on .fill()', () => {
    const v = extractEditableValue(actionStep(
      `await page.locator('#email').fill('hello', { timeout: 5000 });`
    ));
    expect(v).toBe('hello');
  });

  it('returns value from page.keyboard.type()', () => {
    const v = extractEditableValue(actionStep(
      `await page.keyboard.type('Hello World');`
    ));
    expect(v).toBe('Hello World');
  });

  it('returns value from chained .selectOption()', () => {
    const v = extractEditableValue(actionStep(
      `await page.getByRole('combobox').selectOption('CA');`
    ));
    expect(v).toBe('CA');
  });

  it('un-escapes single quotes and backslashes in the value', () => {
    const v = extractEditableValue(actionStep(
      `await page.locator('#x').fill('it\\'s a \\\\ test');`
    ));
    expect(v).toBe("it's a \\ test");
  });

  it('returns null for non-action step', () => {
    const v = extractEditableValue({ id: 0, type: 'assertion', code: `expect(page).toHaveTitle('X');`, label: '', lineStart: 1, lineEnd: 1 });
    expect(v).toBeNull();
  });

  it('returns null when action has no editable value', () => {
    const v = extractEditableValue(actionStep(
      `await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Save\\"]"}], 'click', null, null);`
    ));
    expect(v).toBeNull();
  });
});

describe('removeInlineLocateWithFallback / removeInlineReplayCursorPath line preservation', () => {
  it('preserves line count when stripping locateWithFallback', () => {
    const body = [
      'await page.goto(baseUrl);',
      'async function locateWithFallback(page, selectors, action) {',
      '  for (const sel of selectors) {',
      '    try { return await page.locator(sel.value); } catch {}',
      '  }',
      '  throw new Error("not found");',
      '}',
      '',
      'await locateWithFallback(page, [], "click");',
    ].join('\n');

    const cleaned = removeInlineLocateWithFallback(body);
    expect(cleaned.split('\n').length).toBe(body.split('\n').length);

    const steps = parseSteps(cleaned);
    // Last step should be on the same line as in the original body (line 9, 1-based).
    const last = steps[steps.length - 1];
    expect(last.lineStart).toBe(9);
  });

  it('preserves line count when stripping replayCursorPath', () => {
    const body = [
      'await page.goto(baseUrl);',
      'async function replayCursorPath(page, moves) {',
      '  for (const [x, y] of moves) {',
      '    await page.mouse.move(x, y);',
      '  }',
      '}',
      '',
      'await replayCursorPath(page, []);',
    ].join('\n');

    const cleaned = removeInlineReplayCursorPath(body);
    expect(cleaned.split('\n').length).toBe(body.split('\n').length);

    const steps = parseSteps(cleaned);
    const last = steps[steps.length - 1];
    expect(last.lineStart).toBe(8);
  });

  it('preserves line count across both strippers chained', () => {
    const body = [
      'await page.goto(baseUrl);',
      'async function locateWithFallback(page, selectors, action) {',
      '  for (const sel of selectors) {',
      '    try { return await page.locator(sel.value); } catch {}',
      '  }',
      '  throw new Error("not found");',
      '}',
      'async function replayCursorPath(page, moves) {',
      '  for (const [x, y] of moves) {',
      '    await page.mouse.move(x, y);',
      '  }',
      '}',
      '',
      'await locateWithFallback(page, [], "click");',
    ].join('\n');

    const cleaned = removeInlineReplayCursorPath(removeInlineLocateWithFallback(body));
    expect(cleaned.split('\n').length).toBe(body.split('\n').length);

    const steps = parseSteps(cleaned);
    const last = steps[steps.length - 1];
    expect(last.lineStart).toBe(14);
  });
});

describe('priority ordering of selectors', () => {
  it('prefers role-name over css-path', () => {
    const labels = labelsFor(
      `  await locateWithFallback(page, [{"type":"css-path","value":"div > button.primary"},{"type":"role-name","value":"role=button[name=\\"Submit\\"]"}], 'click', null, null);`
    );
    expect(labels[0]).toBe('Click button "Submit"');
  });

  it('prefers data-testid over css-path', () => {
    const labels = labelsFor(
      `  await locateWithFallback(page, [{"type":"css-path","value":"div > input"},{"type":"data-testid","value":"[data-testid=\\"search-input\\"]"}], 'click', null, null);`
    );
    expect(labels[0]).toBe('Click testid "search-input"');
  });
});
