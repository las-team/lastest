/**
 * Lightweight cron expression utilities.
 * Parses standard 5-field cron expressions (minute hour day month weekday).
 * No external dependency — uses a simple parser for common patterns.
 */

export const PRESET_SCHEDULES = {
  every_15m: { cron: '*/15 * * * *', label: 'Every 15 minutes' },
  hourly: { cron: '0 * * * *', label: 'Every hour' },
  every_6h: { cron: '0 */6 * * *', label: 'Every 6 hours' },
  daily_3am: { cron: '0 3 * * *', label: 'Daily at 3:00 AM' },
  daily_midnight: { cron: '0 0 * * *', label: 'Daily at midnight' },
  weekly_sunday: { cron: '0 3 * * 0', label: 'Weekly on Sunday at 3:00 AM' },
  weekly_monday: { cron: '0 3 * * 1', label: 'Weekly on Monday at 3:00 AM' },
} as const;

export type PresetScheduleKey = keyof typeof PRESET_SCHEDULES;

/**
 * Validate a 5-field cron expression.
 */
export function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges = [
    { min: 0, max: 59 },  // minute
    { min: 0, max: 23 },  // hour
    { min: 1, max: 31 },  // day of month
    { min: 1, max: 12 },  // month
    { min: 0, max: 7 },   // day of week (0 and 7 = Sunday)
  ];

  for (let i = 0; i < 5; i++) {
    if (!isValidCronField(parts[i], ranges[i].min, ranges[i].max)) return false;
  }
  return true;
}

function isValidCronField(field: string, min: number, max: number): boolean {
  if (field === '*') return true;

  // Handle lists: 1,2,3
  const parts = field.split(',');
  for (const part of parts) {
    // Handle step: */5 or 1-10/2
    const stepParts = part.split('/');
    if (stepParts.length > 2) return false;

    if (stepParts.length === 2) {
      const step = parseInt(stepParts[1], 10);
      if (isNaN(step) || step < 1) return false;
    }

    const range = stepParts[0];
    if (range === '*') continue;

    // Handle range: 1-5
    const rangeParts = range.split('-');
    if (rangeParts.length > 2) return false;

    for (const r of rangeParts) {
      const num = parseInt(r, 10);
      if (isNaN(num) || num < min || num > max) return false;
    }
  }
  return true;
}

/**
 * Parse a cron field and expand to matching values.
 */
function expandCronField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;

    let start = min;
    let end = max;

    if (range !== '*') {
      const rangeParts = range.split('-');
      start = parseInt(rangeParts[0], 10);
      end = rangeParts.length > 1 ? parseInt(rangeParts[1], 10) : start;
    }

    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Compute the next run time from a cron expression, starting from a given date.
 */
export function getNextRunTime(cronExpression: string, from: Date = new Date()): Date {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${cronExpression}`);

  const minutes = expandCronField(parts[0], 0, 59);
  const hours = expandCronField(parts[1], 0, 23);
  const daysOfMonth = expandCronField(parts[2], 1, 31);
  const months = expandCronField(parts[3], 1, 12);
  const daysOfWeek = expandCronField(parts[4], 0, 7).map(d => d === 7 ? 0 : d); // normalize Sunday

  const hasDayOfMonthConstraint = parts[2] !== '*';
  const hasDayOfWeekConstraint = parts[4] !== '*';

  // Start one minute after `from`
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 366 days ahead
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getMonth() + 1;
    const dayOfMonth = candidate.getDate();
    const dayOfWeek = candidate.getDay();
    const hour = candidate.getHours();
    const minute = candidate.getMinutes();

    if (!months.includes(month)) {
      // Skip to next month
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    // Day matching: if both day-of-month and day-of-week are constrained, match either (union)
    const dayOfMonthMatch = !hasDayOfMonthConstraint || daysOfMonth.includes(dayOfMonth);
    const dayOfWeekMatch = !hasDayOfWeekConstraint || daysOfWeek.includes(dayOfWeek);

    const dayMatch = (hasDayOfMonthConstraint && hasDayOfWeekConstraint)
      ? (dayOfMonthMatch || dayOfWeekMatch)
      : (dayOfMonthMatch && dayOfWeekMatch);

    if (!dayMatch) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    if (!hours.includes(hour)) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!minutes.includes(minute)) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
      continue;
    }

    return candidate;
  }

  throw new Error(`Could not find next run time for cron: ${cronExpression}`);
}

/**
 * Human-readable description of a cron expression.
 */
export function describeCron(expression: string): string {
  // Check presets first
  for (const [, preset] of Object.entries(PRESET_SCHEDULES)) {
    if (preset.cron === expression) return preset.label;
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [min, hour, dom, mon, dow] = parts;

  // Common patterns
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${min.slice(2)} minutes`;
  }
  if (hour.startsWith('*/') && min === '0' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${hour.slice(2)} hours`;
  }
  if (dom === '*' && mon === '*' && dow === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (dom === '*' && mon === '*' && dow !== '*') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayNum = parseInt(dow, 10);
    const dayName = days[dayNum] ?? dow;
    return `${dayName} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }

  return expression;
}
