import { describe, it, expect } from 'vitest';
import { eventsToCodeLines, type CodeGenEvent } from './event-to-code';

function lines(events: CodeGenEvent[]): string[] {
  return eventsToCodeLines(events, 'https://example.com', true, { indent: '' });
}

describe('eventsToCodeLines — wait events', () => {
  it('emits page.waitForTimeout for duration waits', () => {
    const out = lines([
      { type: 'wait', timestamp: 1, data: { waitType: 'duration', durationMs: 180000 } },
    ]);
    expect(out).toEqual(['await page.waitForTimeout(180000);']);
  });

  it('floors fractional durations', () => {
    const out = lines([
      { type: 'wait', timestamp: 1, data: { waitType: 'duration', durationMs: 1500.7 } },
    ]);
    expect(out).toEqual(['await page.waitForTimeout(1500);']);
  });

  it('emits waitForSelector with default visible state and 30s timeout', () => {
    const out = lines([
      { type: 'wait', timestamp: 1, data: { waitType: 'selector', selector: '#status' } },
    ]);
    expect(out).toEqual([
      "await page.waitForSelector('#status', { state: 'visible', timeout: 30000 });",
    ]);
  });

  it('honours hidden condition + custom timeout', () => {
    const out = lines([
      {
        type: 'wait',
        timestamp: 1,
        data: { waitType: 'selector', selector: '.spinner', condition: 'hidden', timeoutMs: 5000 },
      },
    ]);
    expect(out).toEqual([
      "await page.waitForSelector('.spinner', { state: 'hidden', timeout: 5000 });",
    ]);
  });

  it('falls back to first valid selector from selectors array', () => {
    const out = lines([
      {
        type: 'wait',
        timestamp: 1,
        data: {
          waitType: 'selector',
          selectors: [
            { type: 'css', value: '' },
            { type: 'role', value: '#ready' },
          ],
        },
      },
    ]);
    expect(out).toEqual([
      "await page.waitForSelector('#ready', { state: 'visible', timeout: 30000 });",
    ]);
  });

  it('escapes single quotes in selector', () => {
    const out = lines([
      {
        type: 'wait',
        timestamp: 1,
        data: { waitType: 'selector', selector: "[data-name='foo']" },
      },
    ]);
    expect(out[0]).toContain("[data-name=\\'foo\\']");
  });

  it('emits a comment when selector wait has no usable selector', () => {
    const out = lines([
      { type: 'wait', timestamp: 1, data: { waitType: 'selector' } },
    ]);
    expect(out).toEqual(['// Skipped wait: no valid selector provided']);
  });
});

describe('eventsToCodeLines — cursor tracking + selectors', () => {
  const click = (selectors: Array<{ type: string; value: string }>): CodeGenEvent => ({
    type: 'action',
    timestamp: 30,
    data: { action: 'click', selectors, coordinates: { x: 100, y: 200 } },
  });

  it('uses locateWithFallback (not mouse.down/up) when a click with selectors follows mouse-down/up', () => {
    const out = lines([
      { type: 'mouse-down', timestamp: 10, data: { coordinates: { x: 100, y: 200 }, button: 0 } },
      { type: 'mouse-up',   timestamp: 20, data: { coordinates: { x: 100, y: 200 }, button: 0 } },
      click([{ type: 'role-name', value: 'role=button[name="OK"]' }]),
    ]);
    const joined = out.join('\n');
    expect(joined).toContain('await page.mouse.move(100, 200);');
    expect(joined).not.toContain('page.mouse.down(');
    expect(joined).not.toContain('page.mouse.up(');
    expect(joined).toContain("await locateWithFallback(page, [{\"type\":\"role-name\",\"value\":\"role=button[name=\\\"OK\\\"]\"}], 'click', null, {\"x\":100,\"y\":200}");
  });

  it('keeps mouse.down/up for a click with no selectors (coordinate-only fallback)', () => {
    const out = lines([
      { type: 'mouse-down', timestamp: 10, data: { coordinates: { x: 50, y: 60 }, button: 0 } },
      { type: 'mouse-up',   timestamp: 20, data: { coordinates: { x: 50, y: 60 }, button: 0 } },
      { type: 'action', timestamp: 30, data: { action: 'click', coordinates: { x: 50, y: 60 } } },
    ]);
    const joined = out.join('\n');
    expect(joined).toContain('await page.mouse.down(');
    expect(joined).toContain('await page.mouse.up(');
    expect(joined).not.toContain('locateWithFallback');
  });

  it('tolerates cursor-move events between mouse-down/up and the click action', () => {
    const out = lines([
      { type: 'mouse-down', timestamp: 10, data: { coordinates: { x: 10, y: 20 }, button: 0 } },
      { type: 'cursor-move', timestamp: 12, data: { coordinates: { x: 11, y: 21 } } },
      { type: 'mouse-up',   timestamp: 15, data: { coordinates: { x: 10, y: 20 }, button: 0 } },
      { type: 'cursor-move', timestamp: 18, data: { coordinates: { x: 12, y: 22 } } },
      click([{ type: 'css-path', value: 'button.primary' }]),
    ]);
    const joined = out.join('\n');
    expect(joined).toContain('replayCursorPath');
    expect(joined).not.toContain('page.mouse.down(');
    expect(joined).not.toContain('page.mouse.up(');
    expect(joined).toContain("locateWithFallback(page, [{\"type\":\"css-path\",\"value\":\"button.primary\"}], 'click'");
  });

  it('passes click modifiers through locateWithFallback (not via keyboard.down/up around mouse ops)', () => {
    const out = lines([
      { type: 'mouse-down', timestamp: 10, data: { coordinates: { x: 1, y: 2 }, button: 0, modifiers: ['Shift'] } },
      { type: 'mouse-up',   timestamp: 20, data: { coordinates: { x: 1, y: 2 }, button: 0, modifiers: ['Shift'] } },
      { type: 'action', timestamp: 30, data: { action: 'click', selectors: [{ type: 'id', value: '#x' }], coordinates: { x: 1, y: 2 }, modifiers: ['Shift'] } },
    ]);
    const joined = out.join('\n');
    expect(joined).not.toContain("page.keyboard.down('Shift')");
    expect(joined).not.toContain("page.keyboard.up('Shift')");
    expect(joined).toContain("modifiers: ['Shift']");
  });
});
