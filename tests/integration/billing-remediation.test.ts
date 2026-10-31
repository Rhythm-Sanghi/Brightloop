import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { prisma } from '../../lib/db/prisma';
import { parseBusinessDate, addUnits } from '../../lib/dates/business-date';
import { runBilling } from '../../lib/services/billing/run';
import { runPeriod } from '../../lib/services/billing/period';
import { cancelInvoice, confirmInvoice } from '../../lib/services/invoices';
import { createAuditLog } from '../../lib/services/audit';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

describe('Billing Remediation & Audit Suite (R1 - R26, A1 - A7, True B10, Audit E1)', () => {
  let testUserId: string;
  let tax18Id: string;
  let prodStandardId: string;
  let planMonthlyId: string;
  let planMonthlyExpiryTrueId: string;
  let planMonthlyExpiryFalseId: string;
  let customerId: string;
  const createdSubIds: string[] = [];

  beforeAll(async () => {
    // 1. Staff user
    const user = await prisma.user.create({
      data: {
        name: 'Audit Remediation Tester',
        email: `audit-tester-${Date.now()}@brightloop.demo`,
        passwordHash: 'dummy',
        role: 'STAFF',
      },
    });
    testUserId = user.id;

    // 2. Tax 18%
    const tax = await prisma.tax.create({
      data: {
        name: `Audit Tax 18% ${Date.now()}`,
        ratePercent: new Decimal('18.00'),
      },
    });
    tax18Id = tax.id;

    // 3. Products
    const prod = await prisma.product.create({
      data: {
        name: `Standard Product ${Date.now()}`,
        type: 'SERVICE',
        salesPrice: new Decimal('1000.00'),
        costPrice: new Decimal('500.00'),
        defaultTaxId: tax18Id,
      },
    });
    prodStandardId = prod.id;

    // 4. Plans
    const planMonthly = await prisma.plan.create({
      data: {
        name: `Monthly Plan ${Date.now()}`,
        billingPeriod: 'MONTHLY',
        billingInterval: 1,
        availableFrom: parseBusinessDate('2026-01-01'),
      },
    });
    planMonthlyId = planMonthly.id;

    const planExpiryTrue = await prisma.plan.create({
      data: {
        name: `Monthly AutoClose Plan ${Date.now()}`,
        billingPeriod: 'MONTHLY',
        billingInterval: 1,
        availableFrom: parseBusinessDate('2026-01-01'),
        autoCloseOnExpiry: true,
      },
    });
    planMonthlyExpiryTrueId = planExpiryTrue.id;

    const planExpiryFalse = await prisma.plan.create({
      data: {
        name: `Monthly NoAutoClose Plan ${Date.now()}`,
        billingPeriod: 'MONTHLY',
        billingInterval: 1,
        availableFrom: parseBusinessDate('2026-01-01'),
        autoCloseOnExpiry: false,
      },
    });
    planMonthlyExpiryFalseId = planExpiryFalse.id;

    // 5. Customer
    const customer = await prisma.customer.create({
      data: {
        name: 'Audit Test Customer',
        email: `audit-customer-${Date.now()}@brightloop.demo`,
      },
    });
    customerId = customer.id;
  });

  afterEach(async () => {
    if (createdSubIds.length > 0) {
      await prisma.subscription.updateMany({
        where: { id: { in: [...createdSubIds] } },
        data: { status: 'CLOSED' },
      });
      createdSubIds.length = 0;
    }
  });

  // Helper to assert R6 totals invariants on any invoice
  async function assertInvoiceTotalsInvariant(invoiceId: string) {
    const inv = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    const subtotal = new Decimal(inv.subtotal);
    const discountTotal = new Decimal(inv.discountTotal);
    const taxableTotal = new Decimal(inv.taxableTotal);
    const taxTotal = new Decimal(inv.taxTotal);
    const total = new Decimal(inv.total);

    expect(subtotal.minus(discountTotal).equals(taxableTotal)).toBe(true);
    expect(taxableTotal.plus(taxTotal).equals(total)).toBe(true);
  }

  // Helper to create active subscription
  async function createSub(
    planId: string,
    startDateStr: string,
    options?: {
      nextBillingDateStr?: string;
      expiryDateStr?: string;
      price?: Decimal;
      billingCycleIndex?: number;
      status?: string;
    }
  ) {
    const startDate = parseBusinessDate(startDateStr);
    const nextBillingDate = options?.nextBillingDateStr
      ? parseBusinessDate(options.nextBillingDateStr)
      : startDate;
    const expiryDate = options?.expiryDateStr
      ? parseBusinessDate(options.expiryDateStr)
      : null;

    const sub = await prisma.subscription.create({
      data: {
        customerId,
        planId,
        status: options?.status ?? 'ACTIVE',
        startDate,
        nextBillingDate,
        expiryDate,
        billingCycleIndex: options?.billingCycleIndex ?? 0,
        paymentTermsDays: 15,
        createdById: testUserId,
        lines: {
          create: [
            {
              productId: prodStandardId,
              quantity: 1,
              unitPrice: options?.price ?? new Decimal('1000.00'),
              taxId: tax18Id,
            },
          ],
        },
      },
      include: { lines: true, plan: true },
    });

    createdSubIds.push(sub.id);
    return sub;
  }

  // Helper to create test billing run
  async function createTestBillingRun(runDate: Date = parseBusinessDate('2026-01-15'), maxPeriods = 1) {
    return prisma.billingRun.create({
      data: {
        startedById: testUserId,
        runDate,
        status: 'RUNNING',
        maxPeriodsPerSubscription: maxPeriods,
      },
    });
  }

  // Helper to create test invoice
  async function createTestInvoice(data: {
    subscriptionId: string;
    periodStart: Date;
    periodEnd: Date;
    issueDate?: Date;
    dueDate?: Date;
    number?: string | null;
    status?: string;
    subtotal?: Decimal;
    discountTotal?: Decimal;
    taxableTotal?: Decimal;
    taxTotal?: Decimal;
    total?: Decimal;
    discountId?: string;
    discounts?: { discountId: string; amount: Decimal }[];
  }) {
    const periodStart = data.periodStart;
    const periodEnd = data.periodEnd;
    const issueDate = data.issueDate ?? periodStart;
    const dueDate = data.dueDate ?? addUnits(issueDate, 'DAILY', 15, 1);
    const subtotal = data.subtotal ?? new Decimal('1000.00');
    const discountTotal = data.discountTotal ?? new Decimal('0.00');
    const taxableTotal = data.taxableTotal ?? subtotal.minus(discountTotal);
    const taxTotal = data.taxTotal ?? new Decimal('180.00');
    const total = data.total ?? taxableTotal.plus(taxTotal);

    const discountCreate = data.discounts
      ? data.discounts.map((d) => ({ discountId: d.discountId, amount: d.amount }))
      : data.discountId
      ? [{ discountId: data.discountId, amount: discountTotal }]
      : [];

    return prisma.invoice.create({
      data: {
        subscriptionId: data.subscriptionId,
        customerId,
        number: data.number !== undefined ? data.number : `INV-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        status: data.status ?? 'DRAFT',
        issueDate,
        dueDate,
        periodStart,
        periodEnd,
        subtotal,
        discountTotal,
        taxableTotal,
        taxTotal,
        total,
        amountPaid: new Decimal('0.00'),
        ...(discountCreate.length > 0
          ? {
              discounts: {
                create: discountCreate,
              },
            }
          : {}),
      },
    });
  }

  // =============================================================
  // True B10: Two concurrent confirmations of the same DRAFT invoice
  // =============================================================
  it('True B10: two concurrent confirmations of the same DRAFT invoice yield one success and one INVOICE_NOT_CONFIRMED', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');
    const inv = await createTestInvoice({
      subscriptionId: sub.id,
      periodStart: parseBusinessDate('2026-01-01'),
      periodEnd: parseBusinessDate('2026-01-31'),
      status: 'DRAFT',
      number: null,
    });

    const [res1, res2] = await Promise.allSettled([
      confirmInvoice(inv.id, testUserId),
      confirmInvoice(inv.id, testUserId),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
    const rejected = [res1, res2].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const err = rejected[0].reason;
    expect(err?.code).toBe('INVOICE_NOT_CONFIRMED');

    // Exactly one invoice number assigned
    const confirmedInv = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(confirmedInv.number).toMatch(/^INV-\d{4}-\d{6}$/);
  });

  // =============================================================
  // Audit E1: Two-discount cancellation tests
  // =============================================================
  it('Audit E1 Happy Path: two-discount invoice cancellation decrements each associated discount by exactly 1 and leaves unlinked discount unchanged', async () => {
    const d1 = await prisma.discount.create({
      data: {
        name: `D1 Assoc ${Date.now()}`,
        kind: 'FIXED',
        value: new Decimal('10.00'),
        scope: 'SUBSCRIPTION',
        startsOn: parseBusinessDate('2026-01-01'),
        timesUsed: 1,
        isActive: true,
      },
    });

    const d2 = await prisma.discount.create({
      data: {
        name: `D2 Assoc ${Date.now()}`,
        kind: 'FIXED',
        value: new Decimal('20.00'),
        scope: 'SUBSCRIPTION',
        startsOn: parseBusinessDate('2026-01-01'),
        timesUsed: 2,
        isActive: true,
      },
    });

    const d3Unlinked = await prisma.discount.create({
      data: {
        name: `D3 Unlinked ${Date.now()}`,
        kind: 'FIXED',
        value: new Decimal('30.00'),
        scope: 'SUBSCRIPTION',
        startsOn: parseBusinessDate('2026-01-01'),
        timesUsed: 5,
        isActive: true,
      },
    });

    const sub = await createSub(planMonthlyId, '2026-01-01');
    const inv = await createTestInvoice({
      subscriptionId: sub.id,
      periodStart: parseBusinessDate('2026-01-01'),
      periodEnd: parseBusinessDate('2026-01-31'),
      discountTotal: new Decimal('30.00'),
      discounts: [
        { discountId: d1.id, amount: new Decimal('10.00') },
        { discountId: d2.id, amount: new Decimal('20.00') },
      ],
    });

    await cancelInvoice(inv.id, testUserId);

    const d1After = await prisma.discount.findUniqueOrThrow({ where: { id: d1.id } });
    const d2After = await prisma.discount.findUniqueOrThrow({ where: { id: d2.id } });
    const d3After = await prisma.discount.findUniqueOrThrow({ where: { id: d3Unlinked.id } });

    expect(d1After.timesUsed).toBe(0); // decremented by 1
    expect(d2After.timesUsed).toBe(1); // decremented by 1
    expect(d3After.timesUsed).toBe(5); // unchanged

    const invAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(invAfter.status).toBe('CANCELLED');
  });

  it('Audit E1 Ledger Failure Path: shortfall on any discount release throws and rolls back whole cancellation', async () => {
    const dGood = await prisma.discount.create({
      data: {
        name: `D Good ${Date.now()}`,
        kind: 'FIXED',
        value: new Decimal('10.00'),
        scope: 'SUBSCRIPTION',
        startsOn: parseBusinessDate('2026-01-01'),
        timesUsed: 1,
        isActive: true,
      },
    });

    // Zero usage represents a ledger corruption shortfall
    const dZero = await prisma.discount.create({
      data: {
        name: `D Zero ${Date.now()}`,
        kind: 'FIXED',
        value: new Decimal('20.00'),
        scope: 'SUBSCRIPTION',
        startsOn: parseBusinessDate('2026-01-01'),
        timesUsed: 0,
        isActive: true,
      },
    });

    const sub = await createSub(planMonthlyId, '2026-01-01');
    const inv = await createTestInvoice({
      subscriptionId: sub.id,
      periodStart: parseBusinessDate('2026-01-01'),
      periodEnd: parseBusinessDate('2026-01-31'),
      discountTotal: new Decimal('30.00'),
      discounts: [
        { discountId: dGood.id, amount: new Decimal('10.00') },
        { discountId: dZero.id, amount: new Decimal('20.00') },
      ],
    });

    await expect(cancelInvoice(inv.id, testUserId)).rejects.toThrow(
      /ledger integrity failure/i
    );

    // Assert entire cancellation rolled back
    const dGoodAfter = await prisma.discount.findUniqueOrThrow({ where: { id: dGood.id } });
    expect(dGoodAfter.timesUsed).toBe(1); // rolled back, not decremented

    const invAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(invAfter.status).toBe('DRAFT'); // status not cancelled

    const dZeroAfter = await prisma.discount.findUniqueOrThrow({ where: { id: dZero.id } });
    expect(dZeroAfter.timesUsed).toBe(0);
  });

  // =============================================================
  // Audit A: Pending Classification Tests (A1 - A7)
  // =============================================================
  it('A1: expired, autoCloseOnExpiry true, zero remaining periods: Category 2 only', async () => {
    // Start Jan 1, expiry Feb 15, cycleIndex 2 (Mar 1 > Feb 15 => 0 remaining periods)
    const sub = await createSub(planMonthlyExpiryTrueId, '2026-01-01', {
      expiryDateStr: '2026-02-15',
      nextBillingDateStr: '2026-03-01',
      billingCycleIndex: 2,
    });

    const runDate = parseBusinessDate('2026-03-15');
    const run = await runBilling(testUserId, { runDate, excludeSubscriptionIds: [sub.id] });

    const summaryLog = await prisma.auditLog.findFirst({
      where: { billingRunId: run.id, action: 'BILLING_RUN_SUMMARY' },
    });
    const meta = summaryLog?.metadata as any;

    expect(meta?.subscriptionsAwaitingExpiryClosure).toBe(1); // Category 2
    expect(meta?.subscriptionsAwaitingInvoiceGeneration).toBe(0);
    expect(meta?.subscriptionsAwaitingManualExpiryClosure).toBe(0);
    expect(meta?.subscriptionsPending).toBe(1);
    expect(run.subscriptionsPending).toBe(1);
  });

  it('A2: expired, autoCloseOnExpiry true, at least one remaining billable period: Category 1 only', async () => {
    // Start Jan 1, expiry Mar 15, cycleIndex 0. At Apr 15 runDate, 3 periods are billable (Jan, Feb, Mar <= Mar 15)
    const sub = await createSub(planMonthlyExpiryTrueId, '2026-01-01', {
      expiryDateStr: '2026-03-15',
      billingCycleIndex: 0,
    });

    const runDate = parseBusinessDate('2026-04-15');
    // Limit to 1 invoice so remaining billable periods remain > 0
    const run = await runBilling(testUserId, { runDate, maxPeriods: 1 });

    const summaryLog = await prisma.auditLog.findFirst({
      where: { billingRunId: run.id, action: 'BILLING_RUN_SUMMARY' },
    });
    const meta = summaryLog?.metadata as any;

    expect(meta?.subscriptionsAwaitingInvoiceGeneration).toBe(1); // Category 1
    expect(meta?.subscriptionsAwaitingExpiryClosure).toBe(0);
    expect(meta?.subscriptionsAwaitingManualExpiryClosure).toBe(0);
    expect(meta?.subscriptionsPending).toBe(1);
    expect(run.subscriptionsPending).toBe(1);
  });

  it('A3: expiry date equal to runDate, with a billable period starting that day: Category 1 only', async () => {
    // Expiry Mar 1, runDate Mar 1. Period starts Mar 1. Since periodStart <= expiryDate, period is billable!
    const sub = await createSub(planMonthlyExpiryTrueId, '2026-03-01', {
      expiryDateStr: '2026-03-01',
      billingCycleIndex: 0,
    });

    const runDate = parseBusinessDate('2026-03-01');
    const run = await runBilling(testUserId, { runDate, maxPeriods: 0 }); // maxPeriods 0 to evaluate pending without billing

    const summaryLog = await prisma.auditLog.findFirst({
      where: { billingRunId: run.id, action: 'BILLING_RUN_SUMMARY' },
    });
    const meta = summaryLog?.metadata as any;

    expect(meta?.subscriptionsAwaitingInvoiceGeneration).toBe(1); // Category 1
    expect(meta?.subscriptionsAwaitingExpiryClosure).toBe(0);
    expect(meta?.subscriptionsAwaitingManualExpiryClosure).toBe(0);
    expect(meta?.subscriptionsPending).toBe(1);
    expect(run.subscriptionsPending).toBe(1);
  });

  it('A4: expired, autoCloseOnExpiry false, zero remaining periods: Category 3 only, excluded from subscriptionsPending', async () => {
    // Start Jan 1, expiry Feb 15, cycleIndex 2, autoClose = false => 0 remaining billable periods
    const sub = await createSub(planMonthlyExpiryFalseId, '2026-01-01', {
      expiryDateStr: '2026-02-15',
      nextBillingDateStr: '2026-03-01',
      billingCycleIndex: 2,
    });

    const runDate = parseBusinessDate('2026-03-15');
    const run = await runBilling(testUserId, { runDate, excludeSubscriptionIds: [sub.id] });

    const summaryLog = await prisma.auditLog.findFirst({
      where: { billingRunId: run.id, action: 'BILLING_RUN_SUMMARY' },
    });
    const meta = summaryLog?.metadata as any;

    expect(meta?.subscriptionsAwaitingManualExpiryClosure).toBe(1); // Category 3
    expect(meta?.subscriptionsAwaitingExpiryClosure).toBe(0);
    expect(meta?.subscriptionsAwaitingInvoiceGeneration).toBe(0);
    // Excluded from subscriptionsPending
    expect(meta?.subscriptionsPending).toBe(0);
    expect(run.subscriptionsPending).toBe(0);
  });

  it('A5: PAUSED expired subscription: observed in no billing category and omitted from pending counts', async () => {
    const sub = await createSub(planMonthlyExpiryTrueId, '2026-01-01', {
      expiryDateStr: '2026-02-15',
      status: 'PAUSED',
    });

    const runDate = parseBusinessDate('2026-03-15');
    const run = await runBilling(testUserId, { runDate, excludeSubscriptionIds: [sub.id] });

    const summaryLog = await prisma.auditLog.findFirst({
      where: { billingRunId: run.id, action: 'BILLING_RUN_SUMMARY' },
    });
    const meta = summaryLog?.metadata as any;

    expect(meta?.subscriptionsAwaitingInvoiceGeneration).toBe(0);
    expect(meta?.subscriptionsAwaitingExpiryClosure).toBe(0);
    expect(meta?.subscriptionsAwaitingManualExpiryClosure).toBe(0);
    expect(meta?.subscriptionsPending).toBe(0);
    expect(run.subscriptionsPending).toBe(0);
  });

  it('A6: non-expired ACTIVE subscription with due periods: Category 1 only', async () => {
    // Active subscription with no expiry date and 2 due periods
    const sub = await createSub(planMonthlyId, '2026-01-01');

    const runDate = parseBusinessDate('2026-02-15');
    const run = await runBilling(testUserId, { runDate, maxPeriods: 1 });

    const summaryLog = await prisma.auditLog.findFirst({
      where: { billingRunId: run.id, action: 'BILLING_RUN_SUMMARY' },
    });
    const meta = summaryLog?.metadata as any;

    expect(meta?.subscriptionsAwaitingInvoiceGeneration).toBe(1); // Category 1
    expect(meta?.subscriptionsAwaitingExpiryClosure).toBe(0);
    expect(meta?.subscriptionsAwaitingManualExpiryClosure).toBe(0);
    expect(meta?.subscriptionsPending).toBe(1);
    expect(run.subscriptionsPending).toBe(1);
  });

  it('A7: ACTIVE subscription with zero remaining periods and expiry in future or no expiry: in no category', async () => {
    // Active subscription already current (nextBillingDate Apr 1, runDate Mar 15)
    const sub = await createSub(planMonthlyId, '2026-03-01', {
      nextBillingDateStr: '2026-04-01',
      billingCycleIndex: 1,
      expiryDateStr: '2026-12-31',
    });

    const runDate = parseBusinessDate('2026-03-15');
    const run = await runBilling(testUserId, { runDate, excludeSubscriptionIds: [sub.id] });

    const summaryLog = await prisma.auditLog.findFirst({
      where: { billingRunId: run.id, action: 'BILLING_RUN_SUMMARY' },
    });
    const meta = summaryLog?.metadata as any;

    expect(meta?.subscriptionsAwaitingInvoiceGeneration).toBe(0);
    expect(meta?.subscriptionsAwaitingExpiryClosure).toBe(0);
    expect(meta?.subscriptionsAwaitingManualExpiryClosure).toBe(0);
    expect(meta?.subscriptionsPending).toBe(0);
    expect(run.subscriptionsPending).toBe(0);
  });

  // =============================================================
  // Audit B: Revised R11 (Single-Entity Serialized Business-Event Ordering)
  // =============================================================
  it('Audit B Revised R11: for a single subscription, seq strictly orders lock-protected events in serialized business-event sequence', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');

    // Pre-insert duplicate gap for period 0
    await createTestInvoice({
      subscriptionId: sub.id,
      periodStart: parseBusinessDate('2026-01-01'),
      periodEnd: parseBusinessDate('2026-01-31'),
    });

    const runDate = parseBusinessDate('2026-02-15');
    const run = await runBilling(testUserId, { runDate, maxPeriods: 1 });

    // Retrieve lock-protected audit rows for this subscription
    const rows = await prisma.auditLog.findMany({
      where: {
        billingRunId: run.id,
        entityType: 'Subscription',
        entityId: sub.id,
      },
      orderBy: { seq: 'asc' },
    });

    // The subscription underwent: (1) Repair of period 0, (2) Generation of period 1, (3) Final outcome
    const actions = rows.map((r) => {
      const meta = r.metadata as any;
      if (r.action === 'BILLING_PERIOD') return meta?.result; // REPAIRED or GENERATED
      return r.action; // BILLING_OUTCOME
    });

    expect(actions).toEqual(['REPAIRED', 'GENERATED', 'BILLING_OUTCOME']);

    // Assert strictly increasing seq
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].seq > rows[i - 1].seq).toBe(true);
    }
  });

  // =============================================================
  // Audit C: Consistency Contract & Failure Non-Summary Tests
  // =============================================================
  it('Audit C: completed run with Categories 1, 2, and 3 satisfies exact contract equation', async () => {
    // 1. Category 1: Active with remaining due periods
    const subCat1 = await createSub(planMonthlyId, '2026-01-01');

    // 2. Category 2: Expired, autoCloseOnExpiry true, 0 remaining periods
    const subCat2 = await createSub(planMonthlyExpiryTrueId, '2026-01-01', {
      expiryDateStr: '2026-01-15',
      nextBillingDateStr: '2026-02-01',
      billingCycleIndex: 1,
    });

    // 3. Category 3: Expired, autoCloseOnExpiry false, 0 remaining periods
    const subCat3 = await createSub(planMonthlyExpiryFalseId, '2026-01-01', {
      expiryDateStr: '2026-01-15',
      nextBillingDateStr: '2026-02-01',
      billingCycleIndex: 1,
    });

    const runDate = parseBusinessDate('2026-02-15');
    const run = await runBilling(testUserId, { runDate, maxPeriods: 1 });

    const summaryLog = await prisma.auditLog.findFirst({
      where: { billingRunId: run.id, action: 'BILLING_RUN_SUMMARY' },
    });
    const summary = summaryLog?.metadata as any;

    expect(summary.subscriptionsAwaitingInvoiceGeneration + summary.subscriptionsAwaitingExpiryClosure)
      .toBe(summary.subscriptionsPending);
    expect(summary.subscriptionsPending).toBe(run.subscriptionsPending);
    expect(summary.subscriptionsAwaitingManualExpiryClosure).toBe(1);
  });

  it('Audit C Failure: failed billing run writes BILLING_RUN_FAILED and never writes BILLING_RUN_SUMMARY', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');

    // Create billing run record directly
    const billingRun = await createTestBillingRun(parseBusinessDate('2026-01-15'), 1);

    // Call runPeriod with an error fault
    const res = await runPeriod(sub.id, billingRun.id, parseBusinessDate('2026-01-15'), {
      throwAtPeriodIndex: 0,
    });
    expect(res.type).toBe('FAILED');

    // Confirm no BILLING_RUN_SUMMARY was written
    const summaryLog = await prisma.auditLog.findFirst({
      where: { billingRunId: billingRun.id, action: 'BILLING_RUN_SUMMARY' },
    });
    expect(summaryLog).toBeNull();
  });

  // =============================================================
  // R1 & R6: Usage race under concurrency + Totals invariants
  // =============================================================
  it('R1 & R6: concurrent billing on two subscriptions sharing maxUses=1 discount allocates to exactly one', async () => {
    const discount = await prisma.discount.create({
      data: {
        name: `Shared Max1 Discount ${Date.now()}`,
        kind: 'FIXED',
        value: new Decimal('100.00'),
        scope: 'SUBSCRIPTION',
        startsOn: parseBusinessDate('2026-01-01'),
        maxUses: 1,
        timesUsed: 0,
        isActive: true,
      },
    });

    const sub1 = await createSub(planMonthlyId, '2026-01-01');
    const sub2 = await createSub(planMonthlyId, '2026-01-01');

    await prisma.subscriptionDiscount.createMany({
      data: [
        { subscriptionId: sub1.id, discountId: discount.id },
        { subscriptionId: sub2.id, discountId: discount.id },
      ],
    });

    const runDate = parseBusinessDate('2026-01-15');

    // Run both billing runs concurrently
    await Promise.all([
      runBilling(testUserId, { runDate }),
      runBilling(testUserId, { runDate }),
    ]);

    // Check discount usage
    const discAfter = await prisma.discount.findUniqueOrThrow({
      where: { id: discount.id },
    });
    expect(discAfter.timesUsed).toBe(1);

    // Check invoices
    const inv1 = await prisma.invoice.findFirst({
      where: { subscriptionId: sub1.id },
      include: { discounts: true },
    });
    const inv2 = await prisma.invoice.findFirst({
      where: { subscriptionId: sub2.id },
      include: { discounts: true },
    });

    expect(inv1).not.toBeNull();
    expect(inv2).not.toBeNull();

    // Exactly one invoice received the discount
    const discCount = (inv1?.discounts.length || 0) + (inv2?.discounts.length || 0);
    expect(discCount).toBe(1);

    // Verify R6 totals invariants on both invoices
    await assertInvoiceTotalsInvariant(inv1!.id);
    await assertInvoiceTotalsInvariant(inv2!.id);
  });

  // =============================================================
  // R5: Rollback after increment + R6
  // =============================================================
  it('R5: fault after discount increment rolls back timesUsed and creates no invoice', async () => {
    const discount = await prisma.discount.create({
      data: {
        name: `Rollback Discount ${Date.now()}`,
        kind: 'FIXED',
        value: new Decimal('50.00'),
        scope: 'SUBSCRIPTION',
        startsOn: parseBusinessDate('2026-01-01'),
        maxUses: 5,
        timesUsed: 0,
        isActive: true,
      },
    });

    const sub = await createSub(planMonthlyId, '2026-01-01');
    await prisma.subscriptionDiscount.create({
      data: { subscriptionId: sub.id, discountId: discount.id },
    });

    const billingRun = await createTestBillingRun(parseBusinessDate('2026-01-15'), 1);

    // Run period with throwAfterDiscountIncrement
    const res = await runPeriod(
      sub.id,
      billingRun.id,
      parseBusinessDate('2026-01-15'),
      { throwAfterDiscountIncrement: true }
    );

    expect(res.type).toBe('FAILED');

    // Verify discount timesUsed was NOT incremented (rolled back)
    const discAfter = await prisma.discount.findUniqueOrThrow({
      where: { id: discount.id },
    });
    expect(discAfter.timesUsed).toBe(0);

    // Verify no invoice was created
    const invoices = await prisma.invoice.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(invoices.length).toBe(0);

    // Second run without fault succeeds
    const resSuccess = await runPeriod(
      sub.id,
      billingRun.id,
      parseBusinessDate('2026-01-15')
    );
    expect(resSuccess.type).toBe('INVOICE_CREATED');

    const discAfterSuccess = await prisma.discount.findUniqueOrThrow({
      where: { id: discount.id },
    });
    expect(discAfterSuccess.timesUsed).toBe(1);

    await assertInvoiceTotalsInvariant(resSuccess.invoiceId!);
  });

  // =============================================================
  // R7: Same-period duplicate repaired + R6
  // =============================================================
  it('R7: same-period duplicate detects collision, repairs cursor, and second call generates next invoice', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');
    const period0Start = parseBusinessDate('2026-01-01');
    const period0End = parseBusinessDate('2026-01-31');

    // Pre-insert invoice for period 0 (representing prior successful creation)
    await createTestInvoice({
      subscriptionId: sub.id,
      periodStart: period0Start,
      periodEnd: period0End,
    });

    const billingRun = await createTestBillingRun(parseBusinessDate('2026-02-15'), 2);

    // Calling runPeriod for Feb 15 while subscription cursor is still at period 0
    const repairRes = await runPeriod(
      sub.id,
      billingRun.id,
      parseBusinessDate('2026-02-15')
    );

    expect(repairRes.type).toBe('REPAIRED');
    expect(repairRes.periodIndex).toBe(0);

    // Subscription cursor should have advanced to period 1 (Feb 1)
    const subAfterRepair = await prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(subAfterRepair.billingCycleIndex).toBe(1);
    expect(subAfterRepair.nextBillingDate?.toISOString().slice(0, 10)).toBe('2026-02-01');

    // Second call generates the invoice for period 1
    const nextRes = await runPeriod(
      sub.id,
      billingRun.id,
      parseBusinessDate('2026-02-15')
    );
    expect(nextRes.type).toBe('INVOICE_CREATED');
    expect(nextRes.periodIndex).toBe(1);

    await assertInvoiceTotalsInvariant(nextRes.invoiceId!);
  });

  // =============================================================
  // R8: Mismatched duplicate fails with DATA_INCONSISTENT
  // =============================================================
  it('R8: mismatched duplicate fails with DATA_INCONSISTENT and does not advance cursor', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');

    // Pre-insert invoice with mismatched periodStart (Jan 10 instead of expected Jan 1)
    await createTestInvoice({
      subscriptionId: sub.id,
      periodStart: parseBusinessDate('2026-01-10'),
      periodEnd: parseBusinessDate('2026-02-09'),
    });

    const billingRun = await createTestBillingRun(parseBusinessDate('2026-02-15'), 1);

    const res = await runPeriod(
      sub.id,
      billingRun.id,
      parseBusinessDate('2026-02-15')
    );

    expect(res.type).toBe('FAILED');
    expect(res.errorCode).toBe('DATA_INCONSISTENT');

    // Verify cursor did not advance
    const subAfter = await prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(subAfter.billingCycleIndex).toBe(0);
    expect(subAfter.nextBillingDate?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  // =============================================================
  // R9: Unrelated unique violation not repaired
  // =============================================================
  it('R9: unrelated unique constraint violation fails immediately without repair attempt', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');
    const billingRun = await createTestBillingRun(parseBusinessDate('2026-01-15'), 1);

    const res = await runPeriod(
      sub.id,
      billingRun.id,
      parseBusinessDate('2026-01-15'),
      { throwAtPeriodIndex: 0 }
    );

    expect(res.type).toBe('FAILED');
    expect(res.errorCode).toBe('INTERNAL_ERROR');

    // Verify cursor was not modified
    const subAfter = await prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(subAfter.billingCycleIndex).toBe(0);
  });

  // =============================================================
  // R10: Concurrent recovery
  // =============================================================
  it('R10: two concurrent attempts to bill same period yield exactly one invoice and matching cursor', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');
    const billingRun = await createTestBillingRun(parseBusinessDate('2026-01-15'), 1);
    const runDate = parseBusinessDate('2026-01-15');

    // Two concurrent calls to runPeriod for period 0
    await Promise.all([
      runPeriod(sub.id, billingRun.id, runDate),
      runPeriod(sub.id, billingRun.id, runDate),
    ]);

    // Exactly 1 invoice created for period 0
    const invoices = await prisma.invoice.findMany({
      where: {
        subscriptionId: sub.id,
        periodStart: parseBusinessDate('2026-01-01'),
      },
    });
    expect(invoices.length).toBe(1);

    const subAfter = await prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(subAfter.billingCycleIndex).toBeGreaterThanOrEqual(1);
  });

  // =============================================================
  // R12 (revised): 1 repair + 15 unbilled due periods, maxPeriods = 12
  // =============================================================
  it('R12 (revised): 1 existing invoice requiring repair followed by 15 unbilled due periods on maxPeriods=12 produces 1 repair, 12 new invoices, 3 remaining, PARTIALLY_PROCESSED', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');

    // 1 existing invoice for period 0 requiring repair
    await createTestInvoice({
      subscriptionId: sub.id,
      periodStart: parseBusinessDate('2026-01-01'),
      periodEnd: parseBusinessDate('2026-01-31'),
    });

    // 15 unbilled periods follow (Jan 2026 to Apr 2027 = 16 total periods)
    const runDate = parseBusinessDate('2027-04-15');
    const run = await runBilling(testUserId, { runDate, maxPeriods: 12 });

    const outcome = await prisma.auditLog.findFirst({
      where: {
        billingRunId: run.id,
        action: 'BILLING_OUTCOME',
        entityId: sub.id,
      },
    });

    const meta = outcome?.metadata as any;
    expect(meta?.finalOutcome).toBe('PARTIALLY_PROCESSED');
    expect(meta?.repairsUsed).toBe(1);
    expect(meta?.invoicesGenerated).toBe(12);
    expect(meta?.remainingDuePeriods).toBe(3);

    const totalInvoices = await prisma.invoice.findMany({
      where: { subscriptionId: sub.id },
    });
    // 1 pre-existing + 12 generated = 13 invoices
    expect(totalInvoices.length).toBe(13);

    for (const inv of totalInvoices) {
      await assertInvoiceTotalsInvariant(inv.id);
    }
  });

  // =============================================================
  // R13 & R23 (revised): 4 existing invoices match expected periods, 3 advance in sequence, 4th refused
  // =============================================================
  it('R13 & R23 (revised): 4 duplicate invoices match expected periods, first 3 advance cursor in sequence, fourth refused with REPAIR_LIMIT_EXCEEDED, cursor stays at 3', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');

    // Pre-insert 4 duplicate gaps matching periods 0, 1, 2, 3
    for (let i = 0; i < 4; i++) {
      const pStart = addUnits(parseBusinessDate('2026-01-01'), 'MONTHLY', 1, i);
      const pEnd = addUnits(pStart, 'MONTHLY', 1, 1);
      await createTestInvoice({
        subscriptionId: sub.id,
        periodStart: pStart,
        periodEnd: pEnd,
      });
    }

    const runDate = parseBusinessDate('2026-06-01');
    const run = await runBilling(testUserId, { runDate, maxPeriods: 10 });

    const outcome = await prisma.auditLog.findFirst({
      where: {
        billingRunId: run.id,
        action: 'BILLING_OUTCOME',
        entityId: sub.id,
      },
    });

    const meta = outcome?.metadata as any;
    expect(meta?.finalOutcome).toBe('FAILED');
    expect(meta?.errorCode).toBe('REPAIR_LIMIT_EXCEEDED');
    expect(meta?.repairsUsed).toBe(3);

    // Verify repair audit logs advanced cursor in exact sequence
    const repairLogs = await prisma.auditLog.findMany({
      where: {
        billingRunId: run.id,
        entityType: 'Subscription',
        entityId: sub.id,
        action: 'BILLING_PERIOD',
      },
      orderBy: { seq: 'asc' },
    });

    const repairedIndices = repairLogs
      .filter((l) => (l.metadata as any)?.result === 'REPAIRED')
      .map((l) => (l.metadata as any)?.periodIndex);
    expect(repairedIndices).toEqual([0, 1, 2]);

    const generatedLogs = repairLogs.filter(
      (l) => (l.metadata as { result?: string } | null)?.result === 'GENERATED'
    );
    expect(generatedLogs.length).toBe(0);

    // R23: Cursor must NOT advance past 3
    const subAfter = await prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(subAfter.billingCycleIndex).toBe(3);
    expect(subAfter.nextBillingDate?.toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  // =============================================================
  // R15: Expiry boundary
  // =============================================================
  it('R15: autoCloseOnExpiry transitions to CLOSED on expiry; autoCloseOnExpiry=false stays ACTIVE', async () => {
    // Case A: autoCloseOnExpiry = true
    const subA = await createSub(planMonthlyExpiryTrueId, '2026-01-01', {
      expiryDateStr: '2026-03-01',
    });

    const runDate = parseBusinessDate('2026-03-15');
    await runBilling(testUserId, { runDate });

    const subAAfter = await prisma.subscription.findUniqueOrThrow({
      where: { id: subA.id },
    });
    expect(subAAfter.status).toBe('CLOSED');

    const expiryCloseAudit = await prisma.auditLog.findFirst({
      where: {
        entityId: subA.id,
        toStatus: 'CLOSED',
      },
    });
    expect(expiryCloseAudit).not.toBeNull();

    // Case B: autoCloseOnExpiry = false
    const subB = await createSub(planMonthlyExpiryFalseId, '2026-01-01', {
      expiryDateStr: '2026-03-01',
    });

    await runBilling(testUserId, { runDate });

    const subBAfter = await prisma.subscription.findUniqueOrThrow({
      where: { id: subB.id },
    });
    // Stays ACTIVE
    expect(subBAfter.status).toBe('ACTIVE');
  });

  // =============================================================
  // R16 (revised): Run counters equal outcome rows & count only committed GENERATED BILLING_PERIOD rows
  // =============================================================
  it('R16: billing run counters exactly match outcome rows and committed invoices count', async () => {
    // Sub 1: fully processed
    const sub1 = await createSub(planMonthlyId, '2026-01-01');
    // Sub 2: partially processed (maxPeriods 1, 2 due)
    const sub2 = await createSub(planMonthlyId, '2026-01-01');
    // Sub 3: skipped (already current)
    const sub3 = await createSub(planMonthlyId, '2026-02-01', {
      nextBillingDateStr: '2026-03-01',
    });

    const runDate = parseBusinessDate('2026-02-15');
    const run = await runBilling(testUserId, {
      runDate,
      maxPeriods: 1,
    });

    const outcomes = await prisma.auditLog.findMany({
      where: {
        billingRunId: run.id,
        action: 'BILLING_OUTCOME',
      },
    });

    const totalEvaluated =
      run.subscriptionsFullyProcessed +
      run.subscriptionsPartiallyProcessed +
      run.subscriptionsSkipped +
      run.subscriptionsFailed;

    expect(totalEvaluated).toBe(outcomes.length);

    // Count only committed GENERATED BILLING_PERIOD rows
    const generatedAuditCount = await prisma.auditLog.count({
      where: {
        billingRunId: run.id,
        action: 'BILLING_PERIOD',
        metadata: { path: ['result'], equals: 'GENERATED' },
      },
    });
    expect(run.invoicesGenerated).toBe(generatedAuditCount);
  });

  // =============================================================
  // R20: Concurrent cancellation release
  // =============================================================
  it('R20: two concurrent cancellation calls decrement timesUsed exactly once; losing request returns INVOICE_NOT_CANCELLABLE', async () => {
    const discount = await prisma.discount.create({
      data: {
        name: `Cancel Disc ${Date.now()}`,
        kind: 'FIXED',
        value: new Decimal('20.00'),
        scope: 'SUBSCRIPTION',
        startsOn: parseBusinessDate('2026-01-01'),
        maxUses: 5,
        timesUsed: 1,
        isActive: true,
      },
    });

    const sub = await createSub(planMonthlyId, '2026-01-01');

    const inv = await createTestInvoice({
      subscriptionId: sub.id,
      periodStart: parseBusinessDate('2026-01-01'),
      periodEnd: parseBusinessDate('2026-01-31'),
      discountTotal: new Decimal('20.00'),
      discountId: discount.id,
    });

    // Concurrent cancellations
    const [res1, res2] = await Promise.allSettled([
      cancelInvoice(inv.id, testUserId),
      cancelInvoice(inv.id, testUserId),
    ]);

    // Exactly one fulfilled, one rejected
    const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
    const rejected = [res1, res2].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    expect(rejected[0].reason?.code).toBe('INVOICE_NOT_CANCELLABLE');

    // timesUsed decremented from 1 to 0 (by exactly 1)
    const discAfter = await prisma.discount.findUniqueOrThrow({
      where: { id: discount.id },
    });
    expect(discAfter.timesUsed).toBe(0);

    const auditReversed = await prisma.auditLog.findFirst({
      where: {
        entityId: discount.id,
        action: 'DISCOUNT_USAGE_DECREMENTED',
      },
    });
    expect(auditReversed).not.toBeNull();
  });

  // =============================================================
  // R21 (revised): Retry boundary and budget preservation
  // =============================================================
  it('R21: retry flag prevents infinite loops on persistent duplicate errors and allowRepair=false never commits repair', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');

    // Pre-insert duplicate invoice
    await createTestInvoice({
      subscriptionId: sub.id,
      periodStart: parseBusinessDate('2026-01-01'),
      periodEnd: parseBusinessDate('2026-01-31'),
    });

    const billingRun = await createTestBillingRun(parseBusinessDate('2026-01-15'), 1);

    // Call runPeriod with allowRepair: false
    const res = await runPeriod(
      sub.id,
      billingRun.id,
      parseBusinessDate('2026-01-15'),
      { allowRepair: false }
    );

    // Must never commit a repair
    expect(res.type).toBe('FAILED');
    expect(res.errorCode).toBe('REPAIR_LIMIT_EXCEEDED');

    const subAfter = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(subAfter.billingCycleIndex).toBe(0); // not repaired
  });

  // =============================================================
  // R22: Pending split and summary consistency
  // =============================================================
  it('R22: pending breakdown separates invoice generation and expiry closure in summary audit', async () => {
    // Sub A: needs invoice generation (capped at 1 while 2 due)
    const subA = await createSub(planMonthlyId, '2026-01-01');

    // Sub B: awaiting expiry closure (past expiry, autoCloseOnExpiry: true, 0 remaining invoice periods)
    const subB = await createSub(planMonthlyExpiryTrueId, '2026-01-01', {
      nextBillingDateStr: '2026-02-01',
      expiryDateStr: '2026-01-15',
    });

    const runDate = parseBusinessDate('2026-02-15');
    const run = await runBilling(testUserId, {
      runDate,
      maxPeriods: 1,
    });

    const summaryLog = await prisma.auditLog.findFirst({
      where: {
        billingRunId: run.id,
        action: 'BILLING_RUN_SUMMARY',
      },
    });

    const meta = summaryLog?.metadata as any;
    expect(meta?.subscriptionsPending).toBe(run.subscriptionsPending);
    expect(
      meta?.subscriptionsAwaitingInvoiceGeneration +
        meta?.subscriptionsAwaitingExpiryClosure
    ).toBe(meta?.subscriptionsPending);
  });

  // =============================================================
  // R24: Callback lifetime
  // =============================================================
  it('R24: tryIncrementUsage callback throws if invoked after transaction closes', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');
    const billingRun = await createTestBillingRun(parseBusinessDate('2026-01-15'), 1);

    let capturedCb: ((id: string) => Promise<boolean>) | null = null;

    await runPeriod(
      sub.id,
      billingRun.id,
      parseBusinessDate('2026-01-15'),
      {
        onTryIncrementReady: (cb) => {
          capturedCb = cb;
        },
      }
    );

    expect(capturedCb).not.toBeNull();
    // After transaction has closed, invoking the callback must throw
    await expect(capturedCb!('any-discount-id')).rejects.toThrow(
      /transaction closed/i
    );
  });
});
