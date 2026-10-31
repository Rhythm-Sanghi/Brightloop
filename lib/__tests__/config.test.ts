import { describe, it, expect } from 'vitest';
import { parseBillingMaxPeriods } from '../config';

describe('Billing Cap Configuration', () => {
  it('defaults to 12 when absent or empty', () => {
    expect(parseBillingMaxPeriods()).toBe(12);
    expect(parseBillingMaxPeriods(null)).toBe(12);
    expect(parseBillingMaxPeriods('')).toBe(12);
  });

  it('accepts integers 1 to 120', () => {
    expect(parseBillingMaxPeriods('1')).toBe(1);
    expect(parseBillingMaxPeriods('12')).toBe(12);
    expect(parseBillingMaxPeriods('120')).toBe(120);
    expect(parseBillingMaxPeriods('  60  ')).toBe(60);
  });

  it('rejects 0, negative, floats, >120, non-integers with message naming the variable', () => {
    expect(() => parseBillingMaxPeriods('0')).toThrow(/BILLING_MAX_PERIODS_PER_SUBSCRIPTION/);
    expect(() => parseBillingMaxPeriods('-5')).toThrow(/BILLING_MAX_PERIODS_PER_SUBSCRIPTION/);
    expect(() => parseBillingMaxPeriods('12.5')).toThrow(/BILLING_MAX_PERIODS_PER_SUBSCRIPTION/);
    expect(() => parseBillingMaxPeriods('121')).toThrow(/BILLING_MAX_PERIODS_PER_SUBSCRIPTION/);
    expect(() => parseBillingMaxPeriods('abc')).toThrow(/BILLING_MAX_PERIODS_PER_SUBSCRIPTION/);
    expect(() => parseBillingMaxPeriods('12abc')).toThrow(/BILLING_MAX_PERIODS_PER_SUBSCRIPTION/);
  });
});
