import { describe, it, expect } from 'vitest';
import { isValidCron, getNextRunTime, describeCron, PRESET_SCHEDULES } from './cron';

describe('Cron Utilities', () => {
  describe('isValidCron', () => {
    it('accepts standard 5-field expressions', () => {
      expect(isValidCron('* * * * *')).toBe(true);
      expect(isValidCron('0 0 * * *')).toBe(true);
      expect(isValidCron('30 4 1 1 0')).toBe(true);
    });

    it('accepts step patterns', () => {
      expect(isValidCron('*/15 * * * *')).toBe(true);
      expect(isValidCron('0 */6 * * *')).toBe(true);
      expect(isValidCron('1-30/5 * * * *')).toBe(true);
    });

    it('accepts range patterns', () => {
      expect(isValidCron('0 9-17 * * *')).toBe(true);
      expect(isValidCron('0 0 * * 1-5')).toBe(true);
    });

    it('accepts list patterns', () => {
      expect(isValidCron('0,15,30,45 * * * *')).toBe(true);
      expect(isValidCron('0 0 1,15 * *')).toBe(true);
    });

    it('accepts combined list + range + step', () => {
      expect(isValidCron('0,30 9-17/2 * * *')).toBe(true);
    });

    it('accepts 7 as Sunday (day of week)', () => {
      expect(isValidCron('0 0 * * 7')).toBe(true);
    });

    it('rejects wrong field count', () => {
      expect(isValidCron('* * * *')).toBe(false);
      expect(isValidCron('* * * * * *')).toBe(false);
      expect(isValidCron('*')).toBe(false);
      expect(isValidCron('')).toBe(false);
    });

    it('rejects out-of-range values', () => {
      expect(isValidCron('60 * * * *')).toBe(false);   // minute > 59
      expect(isValidCron('* 24 * * *')).toBe(false);   // hour > 23
      expect(isValidCron('* * 0 * *')).toBe(false);    // day-of-month < 1
      expect(isValidCron('* * * 13 *')).toBe(false);   // month > 12
      expect(isValidCron('* * * 0 *')).toBe(false);    // month < 1
      expect(isValidCron('* * * * 8')).toBe(false);    // day-of-week > 7
    });

    it('rejects malformed step values', () => {
      expect(isValidCron('*/0 * * * *')).toBe(false);  // step < 1
      expect(isValidCron('*/abc * * * *')).toBe(false);
      expect(isValidCron('1/2/3 * * * *')).toBe(false); // too many slashes
    });

    it('rejects malformed ranges', () => {
      expect(isValidCron('1-2-3 * * * *')).toBe(false); // too many dashes
      expect(isValidCron('abc * * * *')).toBe(false);
    });

    it('validates all preset schedules', () => {
      for (const [, preset] of Object.entries(PRESET_SCHEDULES)) {
        expect(isValidCron(preset.cron)).toBe(true);
      }
    });
  });

  describe('getNextRunTime', () => {
    const from = new Date('2026-03-28T10:00:00Z');

    it('calculates next run for every-minute cron', () => {
      const next = getNextRunTime('* * * * *', from);
      expect(next.getTime()).toBe(new Date('2026-03-28T10:01:00Z').getTime());
    });

    it('calculates next run for */15 minutes', () => {
      const next = getNextRunTime('*/15 * * * *', from);
      expect(next.getMinutes() % 15).toBe(0);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    });

    it('calculates next run for specific hour:minute', () => {
      const next = getNextRunTime('30 14 * * *', from);
      expect(next.getHours()).toBe(14);
      expect(next.getMinutes()).toBe(30);
    });

    it('rolls over to next day if time passed', () => {
      const lateFrom = new Date('2026-03-28T15:00:00Z');
      const next = getNextRunTime('0 3 * * *', lateFrom);
      expect(next.getDate()).toBe(29);
      expect(next.getHours()).toBe(3);
    });

    it('handles day-of-week constraint', () => {
      // Next Monday (day 1) from Saturday March 28
      const next = getNextRunTime('0 9 * * 1', from);
      expect(next.getDay()).toBe(1);
    });

    it('handles day-of-month constraint', () => {
      const next = getNextRunTime('0 0 1 * *', from);
      expect(next.getDate()).toBe(1);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    });

    it('handles union of day-of-month AND day-of-week', () => {
      // When both are specified, match either (union)
      const next = getNextRunTime('0 0 15 * 1', from);
      // Should match either the 15th OR any Monday
      const isDay15 = next.getDate() === 15;
      const isMonday = next.getDay() === 1;
      expect(isDay15 || isMonday).toBe(true);
    });

    it('handles month constraint', () => {
      const next = getNextRunTime('0 0 1 6 *', from);
      expect(next.getMonth()).toBe(5); // June = month 5 in JS
    });

    it('normalizes Sunday (7 → 0)', () => {
      const next7 = getNextRunTime('0 0 * * 7', from);
      const next0 = getNextRunTime('0 0 * * 0', from);
      expect(next7.getDay()).toBe(0);
      expect(next0.getDay()).toBe(0);
      expect(next7.getTime()).toBe(next0.getTime());
    });

    it('starts one minute after from (never returns from itself)', () => {
      const exactMinute = new Date('2026-03-28T10:00:00Z');
      const next = getNextRunTime('0 10 * * *', exactMinute);
      expect(next.getTime()).toBeGreaterThan(exactMinute.getTime());
    });

    it('throws on invalid cron expression', () => {
      expect(() => getNextRunTime('bad', from)).toThrow();
    });

    it('works for all preset schedules', () => {
      for (const [, preset] of Object.entries(PRESET_SCHEDULES)) {
        const next = getNextRunTime(preset.cron, from);
        expect(next.getTime()).toBeGreaterThan(from.getTime());
      }
    });
  });

  describe('describeCron', () => {
    it('returns preset labels for matching cron expressions', () => {
      expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
      expect(describeCron('0 * * * *')).toBe('Every hour');
      expect(describeCron('0 3 * * *')).toBe('Daily at 3:00 AM');
      expect(describeCron('0 0 * * *')).toBe('Daily at midnight');
      expect(describeCron('0 3 * * 0')).toBe('Weekly on Sunday at 3:00 AM');
      expect(describeCron('0 3 * * 1')).toBe('Weekly on Monday at 3:00 AM');
    });

    it('describes minute step patterns', () => {
      expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
      expect(describeCron('*/30 * * * *')).toBe('Every 30 minutes');
    });

    it('describes hour step patterns', () => {
      expect(describeCron('0 */2 * * *')).toBe('Every 2 hours');
      expect(describeCron('0 */8 * * *')).toBe('Every 8 hours');
    });

    it('describes daily at specific time', () => {
      expect(describeCron('30 14 * * *')).toBe('Daily at 14:30');
      expect(describeCron('0 9 * * *')).toBe('Daily at 09:00');
    });

    it('describes weekly patterns with day name', () => {
      expect(describeCron('0 9 * * 2')).toBe('Tuesday at 09:00');
      expect(describeCron('30 17 * * 5')).toBe('Friday at 17:30');
    });

    it('returns raw expression for complex patterns', () => {
      const complex = '0,30 9-17 1,15 * *';
      expect(describeCron(complex)).toBe(complex);
    });

    it('returns raw expression for invalid field count', () => {
      expect(describeCron('* * *')).toBe('* * *');
    });
  });
});
