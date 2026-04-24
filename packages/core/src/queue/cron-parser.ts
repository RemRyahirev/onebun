/**
 * Cron Expression Parser
 *
 * Minimal cron parser without external dependencies.
 *
 * Supported syntax:
 * - Specific values: 0, 15, 30
 * - Wildcard: *
 * - Step values: *\/5, *\/15
 * - Ranges: 1-5
 * - Lists: 1,5,10
 *
 * Format (6 fields with seconds, 5 fields without):
 * ┌───────────── second (0-59)
 * │ ┌───────────── minute (0-59)
 * │ │ ┌───────────── hour (0-23)
 * │ │ │ ┌───────────── day of month (1-31)
 * │ │ │ │ ┌───────────── month (1-12)
 * │ │ │ │ │ ┌───────────── day of week (0-6, 0=Sunday)
 * │ │ │ │ │ │
 * * * * * * *
 */

/**
 * Parsed cron schedule
 */
export interface CronSchedule {
  seconds: number[];
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

/**
 * Create an array of numbers from min to max (inclusive)
 */
function range(min: number, max: number): number[] {
  const result: number[] = [];
  for (let i = min; i <= max; i++) {
    result.push(i);
  }

  return result;
}

/**
 * Parse a single cron field
 *
 * @param field - The field value (e.g., "*", "5", "*\/10", "1-5", "1,2,3")
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Array of matching values
 */
function parseField(field: string, min: number, max: number): number[] {
  // Handle lists first (can contain other patterns)
  if (field.includes(',')) {
    const parts = field.split(',');
    const result = new Set<number>();
    for (const part of parts) {
      for (const value of parseField(part.trim(), min, max)) {
        result.add(value);
      }
    }

    return Array.from(result).sort((a, b) => a - b);
  }

  // Wildcard - all values
  if (field === '*') {
    return range(min, max);
  }

  // Step values: */N or N-M/S
  if (field.includes('/')) {
    const [rangeStr, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);

    if (isNaN(step) || step <= 0) {
      throw new Error(`Invalid step value: ${stepStr}`);
    }

    let rangeValues: number[];
    if (rangeStr === '*') {
      rangeValues = range(min, max);
    } else if (rangeStr.includes('-')) {
      const [start, end] = rangeStr.split('-').map((n) => parseInt(n, 10));
      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range: ${rangeStr}`);
      }
      rangeValues = range(start, end);
    } else {
      const start = parseInt(rangeStr, 10);
      if (isNaN(start)) {
        throw new Error(`Invalid range start: ${rangeStr}`);
      }
      rangeValues = range(start, max);
    }

    return rangeValues.filter((_, index) => index % step === 0);
  }

  // Range: N-M
  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);

    if (isNaN(start) || isNaN(end)) {
      throw new Error(`Invalid range: ${field}`);
    }

    if (start < min || end > max || start > end) {
      throw new Error(`Range out of bounds: ${field} (allowed: ${min}-${max})`);
    }

    return range(start, end);
  }

  // Single value
  const value = parseInt(field, 10);
  if (isNaN(value)) {
    throw new Error(`Invalid value: ${field}`);
  }

  if (value < min || value > max) {
    throw new Error(`Value out of bounds: ${value} (allowed: ${min}-${max})`);
  }

  return [value];
}

/**
 * Parse a cron expression into a schedule
 *
 * @param expression - Cron expression (5 or 6 fields)
 * @returns Parsed schedule
 * @throws Error if the expression is invalid
 *
 * @example
 * ```typescript
 * // Every minute
 * parseCronExpression('* * * * *');
 *
 * // Every 5 seconds
 * parseCronExpression('*\/5 * * * * *');
 *
 * // At 9:00 AM every day
 * parseCronExpression('0 9 * * *');
 *
 * // At 9:00 AM on weekdays
 * parseCronExpression('0 9 * * 1-5');
 * ```
 * @see docs:api/queue.md
 */
export function parseCronExpression(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);

  // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Support 5 fields (standard cron) or 6 fields (with seconds)
  if (parts.length === 5) {
    parts.unshift('0'); // Default seconds to 0
  }

  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  if (parts.length !== 6) {
    throw new Error(
      `Invalid cron expression: "${expression}". Expected 5 or 6 fields, got ${parts.length}`,
    );
  }

  return {
    /* eslint-disable @typescript-eslint/no-magic-numbers */
    seconds: parseField(parts[0], 0, 59),
    minutes: parseField(parts[1], 0, 59),
    hours: parseField(parts[2], 0, 23),
    daysOfMonth: parseField(parts[3], 1, 31),
    months: parseField(parts[4], 1, 12),
    daysOfWeek: parseField(parts[5], 0, 6),
    /* eslint-enable @typescript-eslint/no-magic-numbers */
  };
}

/**
 * Find the smallest value in a sorted array that is >= target.
 * Returns null if no such value exists.
 */
function findNextInSorted(values: number[], target: number): number | null {
  for (const v of values) {
    if (v >= target) {
      return v;
    }
  }

  return null;
}

/**
 * Get the number of days in a given month (1-12) for a given year.
 */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
 

/**
 * Get the next run time for a cron schedule
 *
 * Uses field-level skipping instead of second-by-second iteration
 * for O(maxYears * 12 * 31) worst case instead of O(31M).
 *
 * @param schedule - Parsed cron schedule
 * @param from - Start time (defaults to now)
 * @param maxYears - Maximum years to search ahead (defaults to 4 to cover leap year cycles)
 * @returns Next run time, or null if no match found within maxYears
 * @see docs:api/queue.md
 */
export function getNextRun(
  schedule: CronSchedule,
  from: Date = new Date(),
  maxYears: number = 4,
): Date | null {
  const current = new Date(from);
  current.setMilliseconds(0);
  current.setSeconds(current.getSeconds() + 1);

  const endYear = current.getFullYear() + maxYears;

  while (current.getFullYear() <= endYear) {
    // Step 1: Month
    const month = current.getMonth() + 1;
    const nextMonth = findNextInSorted(schedule.months, month);

    if (nextMonth === null) {
      // No matching month left this year -> January next year
      current.setFullYear(current.getFullYear() + 1, 0, 1);
      current.setHours(0, 0, 0, 0);
      continue;
    }

    if (nextMonth > month) {
      current.setMonth(nextMonth - 1, 1);
      current.setHours(0, 0, 0, 0);
      continue;
    }

    // Step 2: Day of month + Day of week
    const maxDays = daysInMonth(current.getFullYear(), month);
    let dayFound = false;

    for (let d = current.getDate(); d <= maxDays; d++) {
      if (!schedule.daysOfMonth.includes(d)) {
        continue;
      }

      // Check day of week for this specific date
      const testDate = new Date(current.getFullYear(), month - 1, d);
      if (!schedule.daysOfWeek.includes(testDate.getDay())) {
        continue;
      }

      // Found a valid day
      if (d > current.getDate()) {
        // Moved to a later day, reset time
        current.setDate(d);
        current.setHours(0, 0, 0, 0);
      }

      dayFound = true;
      break;
    }

    if (!dayFound) {
      // No valid day in this month -> first day of next month
      current.setMonth(current.getMonth() + 1, 1);
      current.setHours(0, 0, 0, 0);
      continue;
    }

    // Step 3: Hour
    const nextHour = findNextInSorted(schedule.hours, current.getHours());

    if (nextHour === null) {
      // No matching hour left today -> next day
      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
      continue;
    }

    if (nextHour > current.getHours()) {
      current.setHours(nextHour, 0, 0, 0);
      continue;
    }

    // Step 4: Minute
    const nextMinute = findNextInSorted(schedule.minutes, current.getMinutes());

    if (nextMinute === null) {
      // No matching minute left this hour -> next hour
      current.setHours(current.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (nextMinute > current.getMinutes()) {
      current.setMinutes(nextMinute, 0, 0);
      continue;
    }

    // Step 5: Second
    const nextSecond = findNextInSorted(schedule.seconds, current.getSeconds());

    if (nextSecond === null) {
      // No matching second left this minute -> next minute
      current.setMinutes(current.getMinutes() + 1, 0, 0);
      continue;
    }

    if (nextSecond > current.getSeconds()) {
      current.setSeconds(nextSecond, 0);
      continue;
    }

    // All fields match
    return current;
  }

  return null;
}
 

/**
 * Get multiple future run times for a cron schedule
 *
 * @param schedule - Parsed cron schedule
 * @param count - Number of run times to return
 * @param from - Start time (defaults to now)
 * @returns Array of future run times
 */
export function getNextRuns(
  schedule: CronSchedule,
  count: number,
  from: Date = new Date(),
): Date[] {
  const result: Date[] = [];
  let current = from;

  for (let i = 0; i < count; i++) {
    const next = getNextRun(schedule, current);
    if (!next) {
      break;
    }
    result.push(next);
    current = next;
  }

  return result;
}

/**
 * Calculate milliseconds until the next cron run
 *
 * @param expression - Cron expression
 * @param from - Start time (defaults to now)
 * @returns Milliseconds until next run, or null if no match found
 */
export function getMillisecondsUntilNextRun(
  expression: string,
  from: Date = new Date(),
): number | null {
  const schedule = parseCronExpression(expression);
  const nextRun = getNextRun(schedule, from);

  if (!nextRun) {
    return null;
  }

  return nextRun.getTime() - from.getTime();
}

/**
 * Validate a cron expression
 *
 * @param expression - Cron expression to validate
 * @returns true if valid, false otherwise
 * @see docs:api/queue.md
 */
export function isValidCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);

    return true;
  } catch {
    return false;
  }
}
