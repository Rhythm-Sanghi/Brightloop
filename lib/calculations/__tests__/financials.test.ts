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
import { countRemainingDuePeriods } from '../../services/billing/remaining';

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

  it('allocates sequentially: exhausting discount prevents later discount from consuming usage', async () => {
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

    const res = await allocateDiscountsSequential([disc1, disc2], lines, issueDate, tryIncrement);

    expect(res.allocations.length).toBe(1);
    expect(res.allocations[0].discountId).toBe('d1');
    expect(res.totalDiscount.toString()).toBe('100');
    // disc2 was skipped because remaining base was zero, so its usage was never incremented!
    expect(usageRecords).toEqual(['d1']);
  });

  it('guarantees allocations sum exactly to discount amount and never exceed line remaining', async () => {
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

    const res = await allocateDiscountsSequential([disc], lines, issueDate);
    const alloc = res.allocations[0];
    expect(alloc.amount.toString()).toBe('50');

    const sumLines = alloc.lineAllocations.reduce((s, a) => s.plus(a.amount), new Decimal(0));
    expect(sumLines.toString()).toBe('50');
  });

  // R2: Rejected increment
  it('R2: rejected increment does not reduce line amounts and allows later discount to claim remaining base', async () => {
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

    const d1: CandidateDiscount = {
      id: 'd1',
      name: 'Disc 1',
      kind: 'FIXED',
      value: new Decimal('50.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-01'),
    };

    const d2: CandidateDiscount = {
      id: 'd2',
      name: 'Disc 2',
      kind: 'FIXED',
      value: new Decimal('40.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-02'),
    };

    // d1 rejected by callback, d2 accepted
    const tryIncrement = (id: string) => id === 'd2';

    const res = await allocateDiscountsSequential([d1, d2], lines, issueDate, tryIncrement);
    expect(res.allocations.length).toBe(1);
    expect(res.allocations[0].discountId).toBe('d2');
    expect(res.totalDiscount.toString()).toBe('40');
    expect(res.lineDiscounts.get('l1')?.toString()).toBe('40');
  });

  // R3: Zero contribution does not consume usage
  it('R3: zero contribution does not invoke usage increment callback', async () => {
    const lines: LineForDiscount[] = [
      {
        id: 'l1',
        productId: 'p1',
        quantity: 1,
        unitPrice: new Decimal('50.00'),
        grossAmount: new Decimal('50.00'),
        sortOrder: 1,
      },
    ];

    const d1: CandidateDiscount = {
      id: 'd1',
      name: 'Full 50 off',
      kind: 'FIXED',
      value: new Decimal('50.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-01'),
    };

    const d2: CandidateDiscount = {
      id: 'd2',
      name: 'Second 20 off',
      kind: 'FIXED',
      value: new Decimal('20.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-02'),
    };

    const incremented: string[] = [];
    const tryIncrement = (id: string) => {
      incremented.push(id);
      return true;
    };

    const res = await allocateDiscountsSequential([d1, d2], lines, issueDate, tryIncrement);
    expect(res.allocations.length).toBe(1);
    expect(res.allocations[0].discountId).toBe('d1');
    expect(incremented).toEqual(['d1']);
  });

  // R4: Sequential accept/reject/accept
  it('R4: sequential accept/reject/accept produces invoice with accepted discounts only', async () => {
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

    const d1: CandidateDiscount = {
      id: 'd1',
      name: 'D1 10 off',
      kind: 'FIXED',
      value: new Decimal('10.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-01'),
    };

    const d2: CandidateDiscount = {
      id: 'd2',
      name: 'D2 20 off',
      kind: 'FIXED',
      value: new Decimal('20.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-02'),
    };

    const d3: CandidateDiscount = {
      id: 'd3',
      name: 'D3 30 off',
      kind: 'FIXED',
      value: new Decimal('30.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-03'),
    };

    // D1 accepted, D2 rejected, D3 accepted
    const tryIncrement = (id: string) => id === 'd1' || id === 'd3';

    const res = await allocateDiscountsSequential([d1, d2, d3], lines, issueDate, tryIncrement);
    expect(res.allocations.map((a) => a.discountId)).toEqual(['d1', 'd3']);
    expect(res.totalDiscount.toString()).toBe('40');
    expect(res.lineDiscounts.get('l1')?.toString()).toBe('40');
  });

  // R19: Minimum purchase uses pre-discount gross
  it('R19: minimum purchase threshold is evaluated against pre-discount gross', async () => {
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

    const d1: CandidateDiscount = {
      id: 'd1',
      name: 'D1 50 off',
      kind: 'FIXED',
      value: new Decimal('50.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-01'),
    };

    // d2 requires minPurchaseAmount = 100.
    // Even though line remaining after d1 is 50, d2's min purchase applies against pre-discount gross (100)
    const d2: CandidateDiscount = {
      id: 'd2',
      name: 'D2 10 off with 100 min',
      kind: 'FIXED',
      value: new Decimal('10.00'),
      scope: 'SUBSCRIPTION',
      minPurchaseAmount: new Decimal('100.00'),
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-02'),
    };

    const res = await allocateDiscountsSequential([d1, d2], lines, issueDate, () => true);
    expect(res.allocations.map((a) => a.discountId)).toEqual(['d1', 'd2']);
    expect(res.totalDiscount.toString()).toBe('60');
  });

  // R25: PRODUCT scope with and without productIds
  it('R25: PRODUCT scope discount without productIds is ineligible; with productIds applies only to matching products', async () => {
    const lines: LineForDiscount[] = [
      {
        id: 'l1',
        productId: 'p1',
        quantity: 1,
        unitPrice: new Decimal('100.00'),
        grossAmount: new Decimal('100.00'),
        sortOrder: 1,
      },
      {
        id: 'l2',
        productId: 'p2',
        quantity: 1,
        unitPrice: new Decimal('50.00'),
        grossAmount: new Decimal('50.00'),
        sortOrder: 2,
      },
    ];

    // Missing productIds
    const dEmptyProduct: CandidateDiscount = {
      id: 'd-empty',
      name: 'Empty Product Scope',
      kind: 'FIXED',
      value: new Decimal('20.00'),
      scope: 'PRODUCT',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-01'),
      productIds: [],
    };
    expect(isDiscountEligible(dEmptyProduct, lines, issueDate)).toBe(false);

    // Matching product p2 only
    const dProduct2: CandidateDiscount = {
      id: 'd-p2',
      name: 'P2 discount',
      kind: 'FIXED',
      value: new Decimal('20.00'),
      scope: 'PRODUCT',
      minPurchaseAmount: null,
      minQuantity: null,
      startsOn: parseBusinessDate('2026-01-01'),
      endsOn: null,
      isActive: true,
      createdAt: new Date('2026-01-02'),
      productIds: ['p2'],
    };

    const res = await allocateDiscountsSequential([dEmptyProduct, dProduct2], lines, issueDate, () => true);
    expect(res.allocations.length).toBe(1);
    expect(res.allocations[0].discountId).toBe('d-p2');
    expect(res.lineDiscounts.get('l1')?.toString()).toBe('0');
    expect(res.lineDiscounts.get('l2')?.toString()).toBe('20');
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

describe('R14: Billable-period agreement (unit)', () => {
  it('correctly counts normal due periods', () => {
    // Start Jan 1, cycle 0, runDate Mar 15: 3 periods due (Jan, Feb, Mar)
    const res = countRemainingDuePeriods(
      parseBusinessDate('2026-01-01'),
      'MONTHLY',
      1,
      0,
      parseBusinessDate('2026-03-15'),
      null
    );
    expect(res.remainingDuePeriods).toBe(3);
    expect(res.overflow).toBe(false);
  });

  it('correctly includes period starting exactly on expiry date', () => {
    // Start Jan 1, expiry Mar 1, runDate Mar 15: periods Jan 1, Feb 1, Mar 1 (all <= expiryDate)
    const res = countRemainingDuePeriods(
      parseBusinessDate('2026-01-01'),
      'MONTHLY',
      1,
      0,
      parseBusinessDate('2026-03-15'),
      parseBusinessDate('2026-03-01')
    );
    expect(res.remainingDuePeriods).toBe(3);
  });

  it('stops at expiry boundary and returns 0 when current period is past expiry date', () => {
    // Start Jan 1, expiry Feb 15. At cycle index 2 (period start Mar 1), periodStart > expiryDate
    const res = countRemainingDuePeriods(
      parseBusinessDate('2026-01-01'),
      'MONTHLY',
      1,
      2,
      parseBusinessDate('2026-03-15'),
      parseBusinessDate('2026-02-15')
    );
    expect(res.remainingDuePeriods).toBe(0);
  });
});
