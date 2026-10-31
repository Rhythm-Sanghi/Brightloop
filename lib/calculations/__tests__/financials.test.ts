import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { round2 } from '../../money';
import {
  allocateDiscountsSequential,
  CandidateDiscount,
  LineForDiscount,
  isDiscountEligible,
} from '../discounts';
import { calculateInvoiceTotals, RawInvoiceLineInput } from '../invoice';
import { calculateMRRandARR, SubscriptionForMRR } from '../mrr';
import { isInvoiceOverdue } from '../overdue';
import { calculateHistoricalChurn, AuditRowForChurn } from '../churn';
import { parseBusinessDate } from '../../dates/business-date';

describe('Financial Calculations: Money, Tax & Invoice Totals', () => {
  it('applies ROUND_HALF_UP correctly', () => {
    expect(round2(new Decimal('10.004')).toString()).toBe('10');
    expect(round2(new Decimal('10.005')).toString()).toBe('10.01');
    expect(round2(new Decimal('10.006')).toString()).toBe('10.01');
  });

  it('calculates invoice totals and asserts subtotal - discountTotal == taxableTotal', () => {
    const rawLines: RawInvoiceLineInput[] = [
      {
        productId: 'prod_1',
        description: 'Suite',
        quantity: 2,
        unitPrice: new Decimal('1000.00'),
        allocatedDiscount: new Decimal('200.00'),
        taxRatePercent: new Decimal('18.00'),
        sortOrder: 1,
      },
      {
        productId: 'prod_2',
        description: 'Addon',
        quantity: 1,
        unitPrice: new Decimal('500.00'),
        allocatedDiscount: new Decimal('50.00'),
        taxRatePercent: new Decimal('12.00'),
        sortOrder: 2,
      },
    ];

    const result = calculateInvoiceTotals(rawLines);

    // Line 1: gross = 2000, discount = 200, taxable = 1800, tax = 1800 * 18% = 324
    // Line 2: gross = 500, discount = 50, taxable = 450, tax = 450 * 12% = 54
    expect(result.subtotal.toString()).toBe('2500');
    expect(result.discountTotal.toString()).toBe('250');
    expect(result.taxableTotal.toString()).toBe('2250');
    expect(result.taxTotal.toString()).toBe('378');
    expect(result.total.toString()).toBe('2628');
    expect(result.taxableTotal.equals(result.subtotal.minus(result.discountTotal))).toBe(true);
  });
});

describe('Discount Eligibility and Sequential Allocation', () => {
  const issueDate = parseBusinessDate('2026-06-15');

  it('checks date boundaries, min purchase, min quantity, inactive, and maxUses', () => {
    const lines: LineForDiscount[] = [
      {
        id: 'line_1',
        productId: 'prod_a',
        quantity: 2,
        unitPrice: new Decimal('500.00'),
        grossAmount: new Decimal('1000.00'),
        sortOrder: 1,
      },
    ];

    const baseDiscount: CandidateDiscount = {
      id: 'disc_1',
      name: 'Summer Sale',
      kind: 'PERCENT',
      value: new Decimal('10'),
      scope: 'PRODUCT',
      productIds: ['prod_a'],
      minPurchaseAmount: new Decimal('800.00'),
      minQuantity: 2,
      startsOn: parseBusinessDate('2026-06-01'),
      endsOn: parseBusinessDate('2026-06-30'),
      maxUses: 5,
      timesUsed: 0,
      isActive: true,
      createdAt: new Date('2026-01-01'),
    };

    expect(isDiscountEligible(baseDiscount, lines, issueDate)).toBe(true);

    // Boundary check
    expect(isDiscountEligible(baseDiscount, lines, parseBusinessDate('2026-06-01'))).toBe(true);
    expect(isDiscountEligible(baseDiscount, lines, parseBusinessDate('2026-06-30'))).toBe(true);
    expect(isDiscountEligible(baseDiscount, lines, parseBusinessDate('2026-05-31'))).toBe(false);
    expect(isDiscountEligible(baseDiscount, lines, parseBusinessDate('2026-07-01'))).toBe(false);

    // Inactive
    expect(isDiscountEligible({ ...baseDiscount, isActive: false }, lines, issueDate)).toBe(false);

    // Min purchase not met
    expect(
      isDiscountEligible({ ...baseDiscount, minPurchaseAmount: new Decimal('1500') }, lines, issueDate)
    ).toBe(false);

    // Min quantity not met
    expect(isDiscountEligible({ ...baseDiscount, minQuantity: 5 }, lines, issueDate)).toBe(false);

    // Exhausted uses
    expect(isDiscountEligible({ ...baseDiscount, timesUsed: 5 }, lines, issueDate)).toBe(false);
  });

  it('allocates sequentially: exhausting discount prevents later discount from consuming usage', () => {
    const lines: LineForDiscount[] = [
      {
        id: 'l1',
        productId: 'p1',
        quantity: 1,
        unitPrice: new Decimal('100.00'),
        grossAmount: new Decimal('100.00'),
        sortOrder: 1,
      },
    ];

    const disc1: CandidateDiscount = {
      id: 'd1',
      name: '100% off',
      kind: 'FIXED',
      value: new Decimal('100.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      maxUses: 10,
      timesUsed: 0,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    const disc2: CandidateDiscount = {
      id: 'd2',
      name: '10% off',
      kind: 'PERCENT',
      value: new Decimal('10.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      maxUses: 10,
      timesUsed: 0,
      isActive: true,
      createdAt: new Date('2026-01-02T00:00:00Z'),
    };

    const usageRecords: string[] = [];
    const tryIncrement = (id: string) => {
      usageRecords.push(id);
      return true;
    };

    const res = allocateDiscountsSequential([disc1, disc2], lines, issueDate, tryIncrement);

    expect(res.allocations.length).toBe(1);
    expect(res.allocations[0].discountId).toBe('d1');
    expect(res.totalDiscount.toString()).toBe('100');
    // disc2 was skipped because remaining base was zero, so its usage was never incremented!
    expect(usageRecords).toEqual(['d1']);
  });

  it('guarantees allocations sum exactly to discount amount and never exceed line remaining', () => {
    const lines: LineForDiscount[] = [
      {
        id: 'l1',
        productId: 'p1',
        quantity: 1,
        unitPrice: new Decimal('33.33'),
        grossAmount: new Decimal('33.33'),
        sortOrder: 1,
      },
      {
        id: 'l2',
        productId: 'p2',
        quantity: 1,
        unitPrice: new Decimal('33.33'),
        grossAmount: new Decimal('33.33'),
        sortOrder: 2,
      },
      {
        id: 'l3',
        productId: 'p3',
        quantity: 1,
        unitPrice: new Decimal('33.34'),
        grossAmount: new Decimal('33.34'),
        sortOrder: 3,
      },
    ];

    const disc: CandidateDiscount = {
      id: 'd1',
      name: 'Fixed 50 off',
      kind: 'FIXED',
      value: new Decimal('50.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      maxUses: null,
      timesUsed: 0,
      isActive: true,
      createdAt: new Date('2026-01-01'),
    };

    const res = allocateDiscountsSequential([disc], lines, issueDate);
    const alloc = res.allocations[0];
    expect(alloc.amount.toString()).toBe('50');

    const sumLines = alloc.lineAllocations.reduce((s, a) => s.plus(a.amount), new Decimal(0));
    expect(sumLines.toString()).toBe('50');
  });
});

describe('MRR & ARR Calculations', () => {
  it('calculates MRR for each billing period and interval independently', () => {
    // ₹1,000 billed quarterly (MONTHLY interval 3) -> 333.33
    const subQuarterly: SubscriptionForMRR = {
      id: 's1',
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      billingInterval: 3,
      startDate: parseBusinessDate('2026-01-01'),
      expiryDate: null,
      nextBillingDate: parseBusinessDate('2026-04-01'),
      recurringValue: new Decimal('1000.00'),
    };

    const resQuarterly = calculateMRRandARR([subQuarterly]);
    expect(resQuarterly.mrrDisplayed.toString()).toBe('333.33');
    expect(resQuarterly.arr.toString()).toBe('3999.96');

    // Monthly interval 1: ₹500 -> 500
    const subMonthly: SubscriptionForMRR = {
      id: 's2',
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      billingInterval: 1,
      startDate: parseBusinessDate('2026-01-01'),
      expiryDate: null,
      nextBillingDate: parseBusinessDate('2026-02-01'),
      recurringValue: new Decimal('500.00'),
    };
    expect(calculateMRRandARR([subMonthly]).mrrDisplayed.toString()).toBe('500');

    // Yearly interval 1: ₹12,000 -> 1000
    const subYearly: SubscriptionForMRR = {
      id: 's3',
      status: 'ACTIVE',
      billingPeriod: 'YEARLY',
      billingInterval: 1,
      startDate: parseBusinessDate('2026-01-01'),
      expiryDate: null,
      nextBillingDate: parseBusinessDate('2027-01-01'),
      recurringValue: new Decimal('12000.00'),
    };
    expect(calculateMRRandARR([subYearly]).mrrDisplayed.toString()).toBe('1000');
  });

  it('excludes paused, closed, and expired awaiting closure subscriptions from MRR', () => {
    const subs: SubscriptionForMRR[] = [
      {
        id: 's_paused',
        status: 'PAUSED',
        billingPeriod: 'MONTHLY',
        billingInterval: 1,
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: null,
        nextBillingDate: parseBusinessDate('2026-02-01'),
        recurringValue: new Decimal('1000.00'),
      },
      {
        id: 's_expired',
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        billingInterval: 1,
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-03-31'),
        nextBillingDate: parseBusinessDate('2026-04-01'), // nextBillingDate > expiryDate
        recurringValue: new Decimal('1000.00'),
      },
    ];

    const res = calculateMRRandARR(subs);
    expect(res.mrrDisplayed.toString()).toBe('0');
  });
});

describe('Overdue Derivation', () => {
  const today = parseBusinessDate('2026-06-15');

  it('identifies overdue when CONFIRMED, due before today, and balance > 0', () => {
    expect(
      isInvoiceOverdue(
        {
          status: 'CONFIRMED',
          dueDate: parseBusinessDate('2026-06-10'),
          total: new Decimal('1000'),
          amountPaid: new Decimal('400'),
        },
        today
      )
    ).toBe(true);

    // Due date today -> not overdue
    expect(
      isInvoiceOverdue(
        {
          status: 'CONFIRMED',
          dueDate: parseBusinessDate('2026-06-15'),
          total: new Decimal('1000'),
          amountPaid: new Decimal('0'),
        },
        today
      )
    ).toBe(false);

    // Fully paid -> not overdue
    expect(
      isInvoiceOverdue(
        {
          status: 'CONFIRMED',
          dueDate: parseBusinessDate('2026-06-10'),
          total: new Decimal('1000'),
          amountPaid: new Decimal('1000'),
        },
        today
      )
    ).toBe(false);

    // DRAFT -> not overdue
    expect(
      isInvoiceOverdue(
        {
          status: 'DRAFT',
          dueDate: parseBusinessDate('2026-06-10'),
          total: new Decimal('1000'),
          amountPaid: new Decimal('0'),
        },
        today
      )
    ).toBe(false);
  });
});

describe('Historical Churn Calculation', () => {
  it('returns 0 when denominator is 0', () => {
    const res = calculateHistoricalChurn(parseBusinessDate('2026-01-01'), parseBusinessDate('2026-01-31'), []);
    expect(res.churnRatePercent).toBe(0);
    expect(res.denominator).toBe(0);
  });

  it('calculates cohort and numerator accurately', () => {
    const from = parseBusinessDate('2026-01-01');
    const to = parseBusinessDate('2026-01-31');

    // Sub1: ACTIVE before period, CLOSED during period
    // Sub2: ACTIVE before period, stays ACTIVE
    // Sub3: Created & ACTIVE during period (should be excluded from cohort!)
    const auditRows: AuditRowForChurn[] = [
      {
        seq: BigInt(1),
        entityId: 'sub1',
        fromStatus: 'CONFIRMED',
        toStatus: 'ACTIVE',
        createdAt: new Date('2025-12-15T10:00:00Z'),
      },
      {
        seq: BigInt(2),
        entityId: 'sub2',
        fromStatus: 'CONFIRMED',
        toStatus: 'ACTIVE',
        createdAt: new Date('2025-12-20T10:00:00Z'),
      },
      {
        seq: BigInt(3),
        entityId: 'sub1',
        fromStatus: 'ACTIVE',
        toStatus: 'CLOSED',
        createdAt: new Date('2026-01-15T10:00:00Z'),
      },
      {
        seq: BigInt(4),
        entityId: 'sub3',
        fromStatus: 'CONFIRMED',
        toStatus: 'ACTIVE',
        createdAt: new Date('2026-01-10T10:00:00Z'),
      },
    ];

    const res = calculateHistoricalChurn(from, to, auditRows);
    expect(res.denominator).toBe(2); // sub1 and sub2
    expect(res.numerator).toBe(1);   // sub1 closed
    expect(res.churnRatePercent).toBe(50.0);
  });
});
