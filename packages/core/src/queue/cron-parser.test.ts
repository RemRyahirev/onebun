/**
 * Cron Parser Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  parseCronExpression,
  getNextRun,
  getNextRuns,
  getMillisecondsUntilNextRun,
  isValidCronExpression,
} from './cron-parser';

describe('cron-parser', () => {
  describe('parseCronExpression', () => {
    it('should parse 5-field expression (without seconds)', () => {
      const schedule = parseCronExpression('* * * * *');
      expect(schedule.seconds).toEqual([0]); // Default seconds = 0
      expect(schedule.minutes.length).toBe(60);
      expect(schedule.hours.length).toBe(24);
      expect(schedule.daysOfMonth.length).toBe(31);
      expect(schedule.months.length).toBe(12);
      expect(schedule.daysOfWeek.length).toBe(7);
    });

    it('should parse 6-field expression (with seconds)', () => {
      const schedule = parseCronExpression('* * * * * *');
      expect(schedule.seconds.length).toBe(60);
      expect(schedule.minutes.length).toBe(60);
    });

    it('should parse specific values', () => {
      const schedule = parseCronExpression('0 30 9 15 6 *');
      expect(schedule.seconds).toEqual([0]);
      expect(schedule.minutes).toEqual([30]);
      expect(schedule.hours).toEqual([9]);
      expect(schedule.daysOfMonth).toEqual([15]);
      expect(schedule.months).toEqual([6]);
    });

    it('should parse step values (*/N)', () => {
      const schedule = parseCronExpression('*/5 */10 * * * *');
      expect(schedule.seconds).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
      expect(schedule.minutes).toEqual([0, 10, 20, 30, 40, 50]);
    });

    it('should parse ranges (N-M)', () => {
      const schedule = parseCronExpression('0 0 9-17 * * 1-5');
      expect(schedule.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
      expect(schedule.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    it('should parse lists (N,M,O)', () => {
      const schedule = parseCronExpression('0 0,15,30,45 * * * *');
      expect(schedule.minutes).toEqual([0, 15, 30, 45]);
    });

    it('should parse combined range and step (N-M/S)', () => {
      const schedule = parseCronExpression('0 0 0-23/2 * * *');
      expect(schedule.hours).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
    });

    it('should throw error for invalid expression', () => {
      expect(() => parseCronExpression('invalid')).toThrow();
      expect(() => parseCronExpression('* * *')).toThrow();
      expect(() => parseCronExpression('* * * * * * *')).toThrow();
    });

    it('should throw error for out of bounds values', () => {
      expect(() => parseCronExpression('60 * * * * *')).toThrow();
      expect(() => parseCronExpression('* 60 * * * *')).toThrow();
      expect(() => parseCronExpression('* * 24 * * *')).toThrow();
      expect(() => parseCronExpression('* * * 32 * *')).toThrow();
      expect(() => parseCronExpression('* * * * 13 *')).toThrow();
      expect(() => parseCronExpression('* * * * * 7')).toThrow();
    });
  });

  describe('getNextRun', () => {
    it('should find next run time for every minute schedule', () => {
      const schedule = parseCronExpression('0 * * * * *');
      const from = new Date('2024-01-15T10:30:45');
      const next = getNextRun(schedule, from);

      expect(next).not.toBeNull();
      expect(next!.getMinutes()).toBe(31);
      expect(next!.getSeconds()).toBe(0);
    });

    it('should find next run time for specific time', () => {
      const schedule = parseCronExpression('0 0 9 * * *');
      const from = new Date('2024-01-15T08:00:00');
      const next = getNextRun(schedule, from);

      expect(next).not.toBeNull();
      expect(next!.getHours()).toBe(9);
      expect(next!.getMinutes()).toBe(0);
      expect(next!.getDate()).toBe(15);
    });

    it('should advance to next day if time has passed', () => {
      const schedule = parseCronExpression('0 0 9 * * *');
      const from = new Date('2024-01-15T10:00:00');
      const next = getNextRun(schedule, from);

      expect(next).not.toBeNull();
      expect(next!.getHours()).toBe(9);
      expect(next!.getDate()).toBe(16);
    });

    it('should respect day of week constraint', () => {
      const schedule = parseCronExpression('0 0 9 * * 1'); // Monday
      const from = new Date('2024-01-15T08:00:00'); // Monday
      const next = getNextRun(schedule, from);

      expect(next).not.toBeNull();
      expect(next!.getDay()).toBe(1); // Monday
    });

    it('should find next run for every 5 seconds', () => {
      const schedule = parseCronExpression('*/5 * * * * *');
      const from = new Date('2024-01-15T10:30:42');
      const next = getNextRun(schedule, from);

      expect(next).not.toBeNull();
      expect(next!.getSeconds()).toBe(45);
    });
  });

  describe('getNextRuns', () => {
    it('should return multiple future run times', () => {
      const schedule = parseCronExpression('0 * * * * *');
      const from = new Date('2024-01-15T10:30:00');
      const runs = getNextRuns(schedule, 3, from);

      expect(runs.length).toBe(3);
      expect(runs[0].getMinutes()).toBe(31);
      expect(runs[1].getMinutes()).toBe(32);
      expect(runs[2].getMinutes()).toBe(33);
    });

    it('should return empty array for impossible schedule', () => {
      // February 31st doesn't exist
      const schedule = parseCronExpression('0 0 0 31 2 *');
      const runs = getNextRuns(schedule, 3, new Date('2024-01-01'));

      expect(runs.length).toBe(0);
    });
  });

  describe('getMillisecondsUntilNextRun', () => {
    it('should calculate milliseconds until next run', () => {
      const from = new Date('2024-01-15T10:30:30.000');
      const ms = getMillisecondsUntilNextRun('0 31 10 * * *', from);

      expect(ms).not.toBeNull();
      // Should be 30 seconds (from 10:30:30 to 10:31:00)
      expect(ms).toBe(30000);
    });

    it('should return null for invalid expression', () => {
      expect(() => getMillisecondsUntilNextRun('invalid', new Date())).toThrow();
    });
  });

  describe('isValidCronExpression', () => {
    it('should return true for valid expressions', () => {
      expect(isValidCronExpression('* * * * *')).toBe(true);
      expect(isValidCronExpression('0 0 9 * * *')).toBe(true);
      expect(isValidCronExpression('*/5 * * * * *')).toBe(true);
      expect(isValidCronExpression('0 0 9-17 * * 1-5')).toBe(true);
    });

    it('should return false for invalid expressions', () => {
      expect(isValidCronExpression('invalid')).toBe(false);
      expect(isValidCronExpression('* * *')).toBe(false);
      expect(isValidCronExpression('60 * * * * *')).toBe(false);
    });
  });
});
