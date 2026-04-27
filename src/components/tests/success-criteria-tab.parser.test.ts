import { describe, it, expect } from 'vitest';
import * as mod from './success-criteria-tab';
import { parseExtractableSelector as parse, collectExtractableSelectors } from '@/lib/playwright/extractable-selector';

describe('parseExtractableSelector', () => {
  it('handles page.locator css', () => {
    expect(parse(`await page.locator('#email').click();`)).toBe('#email');
  });
  it('handles getByRole with name', () => {
    expect(parse(`await page.getByRole('button', { name: 'Submit' }).click();`))
      .toBe(`role=button[name="Submit"]`);
  });
  it('handles getByRole without name', () => {
    expect(parse(`await page.getByRole('navigation').click();`))
      .toBe('role=navigation');
  });
  it('handles getByTestId', () => {
    expect(parse(`await page.getByTestId('email-input').fill('x');`))
      .toBe('[data-testid="email-input"]');
  });
  it('handles getByPlaceholder', () => {
    expect(parse(`await page.getByPlaceholder('Email').fill('x');`))
      .toBe('[placeholder="Email"]');
  });
  it('handles getByLabel', () => {
    expect(parse(`await page.getByLabel('Password').fill('x');`))
      .toBe('[aria-label="Password"]');
  });
  it('handles getByText', () => {
    expect(parse(`await page.getByText('Sign in').click();`))
      .toBe('text=Sign in');
  });
  it('handles locateWithFallback first selector', () => {
    const code = `await locateWithFallback(page, [{"type":"data-testid","value":"[data-testid=\\"submit\\"]"},{"type":"role-name","value":"role=button"}], 'click', null, null);`;
    expect(parse(code)).toBe('[data-testid="submit"]');
  });
  it('returns null for steps without a selector', () => {
    expect(parse(`await page.goto(baseUrl);`)).toBeNull();
  });

  it('module exports the steps tab component', () => {
    expect(mod.TestStepsTab).toBeDefined();
  });
});

describe('collectExtractableSelectors', () => {
  it('returns the union of selectors across steps, skipping unparseable ones', () => {
    const steps = [
      { code: `await page.locator('#email').fill('x');` },
      { code: `await page.goto(baseUrl);` },
      { code: `await page.getByTestId('submit').click();` },
    ];
    const set = collectExtractableSelectors(steps);
    expect(set.has('#email')).toBe(true);
    expect(set.has('[data-testid="submit"]')).toBe(true);
    expect(set.size).toBe(2);
  });
});
