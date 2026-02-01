/**
 * Cron Expression Constants Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import { CronExpression } from './cron-expression';
import { isValidCronExpression } from './cron-parser';

describe('CronExpression', () => {
  describe('seconds patterns', () => {
    it('EVERY_SECOND should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_SECOND)).toBe(true);
    });

    it('EVERY_5_SECONDS should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_5_SECONDS)).toBe(true);
    });

    it('EVERY_10_SECONDS should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_10_SECONDS)).toBe(true);
    });

    it('EVERY_30_SECONDS should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_30_SECONDS)).toBe(true);
    });
  });

  describe('minutes patterns', () => {
    it('EVERY_MINUTE should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_MINUTE)).toBe(true);
    });

    it('EVERY_5_MINUTES should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_5_MINUTES)).toBe(true);
    });

    it('EVERY_10_MINUTES should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_10_MINUTES)).toBe(true);
    });

    it('EVERY_15_MINUTES should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_15_MINUTES)).toBe(true);
    });

    it('EVERY_30_MINUTES should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_30_MINUTES)).toBe(true);
    });
  });

  describe('hours patterns', () => {
    it('EVERY_HOUR should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_HOUR)).toBe(true);
    });

    it('EVERY_2_HOURS should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_2_HOURS)).toBe(true);
    });

    it('EVERY_6_HOURS should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_6_HOURS)).toBe(true);
    });

    it('EVERY_12_HOURS should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_12_HOURS)).toBe(true);
    });
  });

  describe('daily patterns', () => {
    it('EVERY_DAY_AT_MIDNIGHT should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_DAY_AT_MIDNIGHT)).toBe(true);
    });

    it('EVERY_DAY_AT_NOON should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_DAY_AT_NOON)).toBe(true);
    });

    it('EVERY_DAY_AT_9AM should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_DAY_AT_9AM)).toBe(true);
    });
  });

  describe('weekly patterns', () => {
    it('EVERY_WEEK should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_WEEK)).toBe(true);
    });

    it('EVERY_MONDAY should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_MONDAY)).toBe(true);
    });

    it('EVERY_FRIDAY should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_FRIDAY)).toBe(true);
    });

    it('EVERY_WEEKDAY should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_WEEKDAY)).toBe(true);
    });

    it('EVERY_WEEKEND should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_WEEKEND)).toBe(true);
    });
  });

  describe('monthly/yearly patterns', () => {
    it('EVERY_MONTH should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_MONTH)).toBe(true);
    });

    it('EVERY_QUARTER should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_QUARTER)).toBe(true);
    });

    it('EVERY_YEAR should be valid', () => {
      expect(isValidCronExpression(CronExpression.EVERY_YEAR)).toBe(true);
    });
  });

  describe('pattern relationships', () => {
    it('EVERY_WEEK and EVERY_SUNDAY should be the same (Sunday at midnight)', () => {
      // Both represent Sunday at midnight
      expect(CronExpression.EVERY_WEEK).toBe(CronExpression.EVERY_SUNDAY);
    });

    it('should have mostly unique values', () => {
      const values = Object.values(CronExpression);
      const uniqueValues = new Set(values);
      // EVERY_WEEK and EVERY_SUNDAY are intentionally the same
      expect(uniqueValues.size).toBe(values.length - 1);
    });
  });

  describe('all patterns have 6 fields', () => {
    it('should have 6 space-separated fields', () => {
      for (const [_name, pattern] of Object.entries(CronExpression)) {
        const fields = pattern.split(' ');
        expect(fields.length).toBe(6);
      }
    });
  });
});
