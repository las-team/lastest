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
