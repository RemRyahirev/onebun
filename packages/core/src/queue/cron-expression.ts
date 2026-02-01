/**
 * Common Cron Expressions
 *
 * Pre-defined cron expressions for common scheduling patterns.
 * All expressions use 6 fields (with seconds).
 */

/**
 * Common cron expression patterns
 *
 * @example
 * ```typescript
 * import { CronExpression } from '@onebun/core';
 *
 * @Cron(CronExpression.EVERY_MINUTE, { pattern: 'health.check' })
 * getHealthData() {
 *   return { status: 'ok' };
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const CronExpression = {
  // Seconds
  /** Every second */
  EVERY_SECOND: '* * * * * *',
  /** Every 5 seconds */
  EVERY_5_SECONDS: '*/5 * * * * *',
  /** Every 10 seconds */
  EVERY_10_SECONDS: '*/10 * * * * *',
  /** Every 30 seconds */
  EVERY_30_SECONDS: '*/30 * * * * *',

  // Minutes
  /** Every minute (at second 0) */
  EVERY_MINUTE: '0 * * * * *',
  /** Every 5 minutes */
  EVERY_5_MINUTES: '0 */5 * * * *',
  /** Every 10 minutes */
  EVERY_10_MINUTES: '0 */10 * * * *',
  /** Every 15 minutes */
  EVERY_15_MINUTES: '0 */15 * * * *',
  /** Every 30 minutes */
  EVERY_30_MINUTES: '0 */30 * * * *',
  /** Every 45 minutes */
  EVERY_45_MINUTES: '0 */45 * * * *',

  // Hours
  /** Every hour (at minute 0, second 0) */
  EVERY_HOUR: '0 0 * * * *',
  /** Every 2 hours */
  EVERY_2_HOURS: '0 0 */2 * * *',
  /** Every 3 hours */
  EVERY_3_HOURS: '0 0 */3 * * *',
  /** Every 4 hours */
  EVERY_4_HOURS: '0 0 */4 * * *',
  /** Every 6 hours */
  EVERY_6_HOURS: '0 0 */6 * * *',
  /** Every 12 hours */
  EVERY_12_HOURS: '0 0 */12 * * *',

  // Daily
  /** Every day at midnight (00:00:00) */
  EVERY_DAY_AT_MIDNIGHT: '0 0 0 * * *',
  /** Every day at 1 AM */
  EVERY_DAY_AT_1AM: '0 0 1 * * *',
  /** Every day at 2 AM */
  EVERY_DAY_AT_2AM: '0 0 2 * * *',
  /** Every day at 3 AM */
  EVERY_DAY_AT_3AM: '0 0 3 * * *',
  /** Every day at 6 AM */
  EVERY_DAY_AT_6AM: '0 0 6 * * *',
  /** Every day at 9 AM */
  EVERY_DAY_AT_9AM: '0 0 9 * * *',
  /** Every day at noon (12:00:00) */
  EVERY_DAY_AT_NOON: '0 0 12 * * *',
  /** Every day at 6 PM */
  EVERY_DAY_AT_6PM: '0 0 18 * * *',

  // Weekly
  /** Every week (Sunday at midnight) */
  EVERY_WEEK: '0 0 0 * * 0',
  /** Every Monday at midnight */
  EVERY_MONDAY: '0 0 0 * * 1',
  /** Every Tuesday at midnight */
  EVERY_TUESDAY: '0 0 0 * * 2',
  /** Every Wednesday at midnight */
  EVERY_WEDNESDAY: '0 0 0 * * 3',
  /** Every Thursday at midnight */
  EVERY_THURSDAY: '0 0 0 * * 4',
  /** Every Friday at midnight */
  EVERY_FRIDAY: '0 0 0 * * 5',
  /** Every Saturday at midnight */
  EVERY_SATURDAY: '0 0 0 * * 6',
  /** Every Sunday at midnight */
  EVERY_SUNDAY: '0 0 0 * * 0',
  /** Every weekday (Monday-Friday) at midnight */
  EVERY_WEEKDAY: '0 0 0 * * 1-5',
  /** Every weekend (Saturday-Sunday) at midnight */
  EVERY_WEEKEND: '0 0 0 * * 0,6',

  // Monthly
  /** First day of every month at midnight */
  EVERY_MONTH: '0 0 0 1 * *',
  /** First day of every quarter (Jan, Apr, Jul, Oct) at midnight */
  EVERY_QUARTER: '0 0 0 1 1,4,7,10 *',

  // Yearly
  /** First day of the year at midnight (January 1st) */
  EVERY_YEAR: '0 0 0 1 1 *',
} as const;

/**
 * Type for CronExpression values
 */
export type CronExpressionValue = (typeof CronExpression)[keyof typeof CronExpression];
