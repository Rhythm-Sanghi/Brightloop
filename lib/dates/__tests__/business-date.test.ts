import { describe, it, expect } from 'vitest';
import {
  parseBusinessDate,
  formatBusinessDate,
  todayBusinessDate,
  kolkataMidnightUtc,
  addDays,
  addUnits,
  getPeriodDates,
  calculateRenewalExpiry,
  findResumeIndex,
} from '../business-date';

describe('Business Date Helpers and Calendar Arithmetic', () => {
  it('parses valid YYYY-MM-DD and rejects invalid dates', () => {
    const d = parseBusinessDate('2025-01-31');
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(31);

    expect(() => parseBusinessDate('2025-02-29')).toThrow(); // not a leap year
    expect(() => parseBusinessDate('invalid-date')).toThrow();
    expect(() => parseBusinessDate('2025-13-01')).toThrow();
    expect(() => parseBusinessDate('2025-04-31')).toThrow();
  });

  it('formats business dates using UTC without local shift', () => {
    const d = new Date(Date.UTC(2026, 9, 31));
    expect(formatBusinessDate(d)).toBe('2026-10-31');
  });

  it('computes todayBusinessDate and kolkataMidnightUtc', () => {
    // 2026-10-31 01:00 UTC is 2026-10-31 06:30 IST
    const now = new Date('2026-10-31T01:00:00Z');
    const today = todayBusinessDate(now);
    expect(formatBusinessDate(today)).toBe('2026-10-31');

    // 2026-10-31 20:00 UTC is 2026-11-01 01:30 IST
    const late = new Date('2026-10-31T20:00:00Z');
    const nextDay = todayBusinessDate(late);
    expect(formatBusinessDate(nextDay)).toBe('2026-11-01');

    // kolkataMidnightUtc for 2026-10-31 should be 2026-10-30T18:30:00.000Z
    const kolkataMidnight = kolkataMidnightUtc(today);
    expect(kolkataMidnight.toISOString()).toBe('2026-10-30T18:30:00.000Z');
  });

  describe('addUnits specifications', () => {
    it('Anchor Jan 31, 1 month: Feb 28 (Feb 29 in leap year)', () => {
      const anchor2025 = parseBusinessDate('2025-01-31');
      const feb2025 = addUnits(anchor2025, 'MONTHLY', 1, 1);
      expect(formatBusinessDate(feb2025)).toBe('2025-02-28');

      const anchor2024 = parseBusinessDate('2024-01-31');
      const feb2024 = addUnits(anchor2024, 'MONTHLY', 1, 1);
      expect(formatBusinessDate(feb2024)).toBe('2024-02-29');
    });

    it('Anchor Jan 31, 2 months: Mar 31 (anchor preserved)', () => {
      const anchor = parseBusinessDate('2025-01-31');
      const mar = addUnits(anchor, 'MONTHLY', 1, 2);
      expect(formatBusinessDate(mar)).toBe('2025-03-31');
    });

    it('Anchor Oct 31, 1 month: Nov 30', () => {
      const anchor = parseBusinessDate('2025-10-31');
      const nov = addUnits(anchor, 'MONTHLY', 1, 1);
      expect(formatBusinessDate(nov)).toBe('2025-11-30');
    });

    it('Anchor Feb 29, 1 year: Feb 28 of next year', () => {
      const leap = parseBusinessDate('2024-02-29');
      const nextYear = addUnits(leap, 'YEARLY', 1, 1);
      expect(formatBusinessDate(nextYear)).toBe('2025-02-28');
    });

    it('Anchor Feb 29, 4 years: Feb 29', () => {
      const leap = parseBusinessDate('2024-02-29');
      const fourYears = addUnits(leap, 'YEARLY', 1, 4);
      expect(formatBusinessDate(fourYears)).toBe('2028-02-29');
    });

    it('Anchor Aug 31, 1 month: Sep 30', () => {
      const anchor = parseBusinessDate('2025-08-31');
      const sep = addUnits(anchor, 'MONTHLY', 1, 1);
      expect(formatBusinessDate(sep)).toBe('2025-09-30');
    });

    it('DAILY and WEEKLY unit arithmetic', () => {
      const start = parseBusinessDate('2025-01-01');
      expect(formatBusinessDate(addUnits(start, 'DAILY', 1, 10))).toBe('2025-01-11');
      expect(formatBusinessDate(addUnits(start, 'WEEKLY', 2, 1))).toBe('2025-01-15');
    });
  });

  describe('Billing periods and intervals', () => {
    it('computes cycle 0 and cycle 1 boundaries', () => {
      const start = parseBusinessDate('2025-01-31');
      const cycle0 = getPeriodDates(start, 'MONTHLY', 1, 0);
      expect(formatBusinessDate(cycle0.periodStart)).toBe('2025-01-31');
      expect(formatBusinessDate(cycle0.periodEnd)).toBe('2025-02-27');

      const cycle1 = getPeriodDates(start, 'MONTHLY', 1, 1);
      expect(formatBusinessDate(cycle1.periodStart)).toBe('2025-02-28');
      expect(formatBusinessDate(cycle1.periodEnd)).toBe('2025-03-30');
    });
  });

  describe('Renewal and resume calculations', () => {
    it('renewal when not expired: Oct 31 expiry, monthly, renewed Oct 20 -> Nov 30', () => {
      const expiry = parseBusinessDate('2025-10-31');
      const today = parseBusinessDate('2025-10-20');
      const newExpiry = calculateRenewalExpiry(expiry, 'MONTHLY', 1, today);
      expect(formatBusinessDate(newExpiry)).toBe('2025-11-30');
    });

    it('renewal when already expired: Oct 1 expiry, monthly, renewed Oct 15 -> Nov 14', () => {
      const expiry = parseBusinessDate('2025-10-01');
      const today = parseBusinessDate('2025-10-15');
      const newExpiry = calculateRenewalExpiry(expiry, 'MONTHLY', 1, today);
      expect(formatBusinessDate(newExpiry)).toBe('2025-11-14');
    });

    it('findResumeIndex searches forward from cycle index', () => {
      const start = parseBusinessDate('2025-01-01');
      const today = parseBusinessDate('2025-03-15');
      const res = findResumeIndex(start, 'MONTHLY', 1, 0, today);
      // Jan 1 (0), Feb 1 (1), Mar 1 (2), Apr 1 (3 >= Mar 15)
      expect(res.resumeIndex).toBe(3);
      expect(formatBusinessDate(res.nextBillingDate)).toBe('2025-04-01');
    });
  });
});
