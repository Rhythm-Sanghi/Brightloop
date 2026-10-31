import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/db/prisma';
import { parseBusinessDate } from '../../lib/dates/business-date';
import { runBilling } from '../../lib/services/billing/run';
import { confirmInvoice } from '../../lib/services/invoices';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

describe('Milestone M4: Billing Engine & Numbering Integration Tests', () => {
  let testUserId: string;
  let tax18Id: string;
  let prodStandardId: string;
  let planMonthlyId: string;
  let planDailyId: string;
  let customerId: string;

  beforeAll(async () => {
    // 1. Create a staff user for running billing
    const user = await prisma.user.create({
      data: {
        name: 'Billing Tester',
        email: `billing-tester-${Date.now()}@brightloop.demo`,
        passwordHash: 'dummy',
        role: 'STAFF',
      },
    });
    testUserId = user.id;

    // 2. Tax 18%
    const tax = await prisma.tax.create({
      data: {
        name: `Billing Tax 18% ${Date.now()}`,
        ratePercent: new Decimal('18.00'),
      },
    });
    tax18Id = tax.id;

    // 3. Product Standard
    const prod = await prisma.product.create({
      data: {
        name: `Billing Product ${Date.now()}`,
        type: 'SERVICE',
        salesPrice: new Decimal('1000.00'),
        costPrice: new Decimal('500.00'),
        defaultTaxId: tax18Id,
      },
    });
    prodStandardId = prod.id;

    // 4. Monthly Plan
    const planMonthly = await prisma.plan.create({
      data: {
        name: `Monthly Plan ${Date.now()}`,
        billingPeriod: 'MONTHLY',
        billingInterval: 1,
        availableFrom: parseBusinessDate('2026-01-01'),
      },
    });
    planMonthlyId = planMonthly.id;

    // 5. Daily Plan
    const planDaily = await prisma.plan.create({
      data: {
        name: `Daily Plan ${Date.now()}`,
        billingPeriod: 'DAILY',
        billingInterval: 1,
        availableFrom: parseBusinessDate('2026-01-01'),
      },
    });
    planDailyId = planDaily.id;

    // 6. Customer
    const customer = await prisma.customer.create({
      data: {
        name: 'Billing Test Customer',
        email: `billing-customer-${Date.now()}@brightloop.demo`,
      },
    });
    customerId = customer.id;
  });

  // Helper to create an active subscription with lines
  async function createSub(planId: string, startDateStr: string, options?: { nextBillingDateStr?: string; expiryDateStr?: string }) {
    const startDate = parseBusinessDate(startDateStr);
    const nextBillingDate = options?.nextBillingDateStr ? parseBusinessDate(options.nextBillingDateStr) : startDate;
    const expiryDate = options?.expiryDateStr ? parseBusinessDate(options.expiryDateStr) : null;

    return prisma.subscription.create({
      data: {
        customerId,
        planId,
        status: 'ACTIVE',
        startDate,
        nextBillingDate,
        expiryDate,
        billingCycleIndex: 0,
        paymentTermsDays: 15,
        createdById: testUserId,
        lines: {
          create: [
            {
              productId: prodStandardId,
              quantity: 1,
              unitPrice: new Decimal('1000.00'),
              taxId: tax18Id,
            },
          ],
        },
      },
      include: { lines: true, plan: true },
    });
  }

  // -------------------------------------------------------------
  // B1: Concurrent billing runs
  // -------------------------------------------------------------
  it('B1: two concurrent billing runs create exactly 15 invoices across 5 subscriptions with no duplicates', async () => {
    // 5 active subscriptions, each with 3 unbilled periods (Jan 1, Feb 1, Mar 1 with runDate = Mar 15)
    const subIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await createSub(planMonthlyId, '2026-01-01');
      subIds.push(s.id);
    }

    const runDate = parseBusinessDate('2026-03-15');

    // Launch 2 concurrent runs
    const [run1, run2] = await Promise.all([
      runBilling(testUserId, { runDate }),
      runBilling(testUserId, { runDate }),
    ]);

    expect(['COMPLETED', 'COMPLETED_WITH_PENDING']).toContain(run1.status);
    expect(['COMPLETED', 'COMPLETED_WITH_PENDING']).toContain(run2.status);

    // Verify invoices created for these 5 subscriptions
    const invoices = await prisma.invoice.findMany({
      where: { subscriptionId: { in: subIds } },
    });

    expect(invoices.length).toBe(15);

    // Verify no duplicates on (subscriptionId, periodStart)
    const seen = new Set<string>();
    for (const inv of invoices) {
      const key = `${inv.subscriptionId}_${inv.periodStart.toISOString()}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    // Close test subscriptions so they don't affect subsequent runs
    await prisma.subscription.updateMany({
      where: { id: { in: subIds } },
      data: { status: 'CLOSED' },
    });
  });

  // -------------------------------------------------------------
  // B2: Second run on same day creates 0 invoices
  // -------------------------------------------------------------
  it('B2: second run on the same day creates 0 invoices and completes cleanly', async () => {
    const runDate = parseBusinessDate('2026-03-15');
    const run = await runBilling(testUserId, { runDate });

    expect(run.status).toBe('COMPLETED');
    expect(run.invoicesGenerated).toBe(0);
    expect(run.subscriptionsPending).toBe(0);
  });

  // -------------------------------------------------------------
  // B9: Direct duplicate insert rejected by DB
  // -------------------------------------------------------------
  it('B9: direct duplicate insert of (subscriptionId, periodStart) is rejected by unique constraint', async () => {
    const sub = await createSub(planMonthlyId, '2026-04-01');
    const periodStart = parseBusinessDate('2026-04-01');
    const periodEnd = parseBusinessDate('2026-04-30');

    // First insert succeeds
    await prisma.invoice.create({
      data: {
        subscriptionId: sub.id,
        customerId,
        status: 'DRAFT',
        periodStart,
        periodEnd,
        issueDate: periodStart,
        dueDate: periodStart,
        subtotal: '1000.00',
        discountTotal: '0.00',
        taxableTotal: '1000.00',
        taxTotal: '180.00',
        total: '1180.00',
        amountPaid: '0.00',
      },
    });

    // Duplicate insert must throw unique constraint violation (P2002)
    let threw = false;
    try {
      await prisma.invoice.create({
        data: {
          subscriptionId: sub.id,
          customerId,
          status: 'DRAFT',
          periodStart,
          periodEnd,
          issueDate: periodStart,
          dueDate: periodStart,
          subtotal: '1000.00',
          discountTotal: '0.00',
          taxableTotal: '1000.00',
          taxTotal: '180.00',
          total: '1180.00',
          amountPaid: '0.00',
        },
      });
    } catch (e: unknown) {
      threw = true;
      const err = e as { code?: string };
      expect(err.code).toBe('P2002');
    }
    expect(threw).toBe(true);
  });

  // -------------------------------------------------------------
  // B12: Catch-up cap and resumption
  // -------------------------------------------------------------
  it('B12: catch-up cap limits invoices to 12 with PARTIALLY_PROCESSED and second run completes remaining 3', async () => {
    // 1 daily subscription with 15 unbilled periods (Jan 1 through Jan 15, runDate Jan 15)
    const sub = await createSub(planDailyId, '2026-01-01');
    const runDate = parseBusinessDate('2026-01-15');

    // Run 1: cap = 12
    const run1 = await runBilling(testUserId, { runDate, maxPeriods: 12 });
    expect(run1.status).toBe('COMPLETED_WITH_PENDING');
    expect(run1.subscriptionsPending).toBeGreaterThanOrEqual(1);

    const invoicesAfterRun1 = await prisma.invoice.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(invoicesAfterRun1.length).toBe(12);

    const outcome1 = await prisma.auditLog.findFirst({
      where: {
        billingRunId: run1.id,
        action: 'BILLING_OUTCOME',
        entityId: sub.id,
      },
    });
    expect((outcome1?.metadata as any)?.finalOutcome).toBe('PARTIALLY_PROCESSED');

    // Run 2: completes the remaining 3
    const run2 = await runBilling(testUserId, { runDate, maxPeriods: 12 });
    expect(run2.status).toBe('COMPLETED');
    expect(run2.subscriptionsPending).toBe(0);

    const invoicesAfterRun2 = await prisma.invoice.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(invoicesAfterRun2.length).toBe(15);

    const outcome2 = await prisma.auditLog.findFirst({
      where: {
        billingRunId: run2.id,
        action: 'BILLING_OUTCOME',
        entityId: sub.id,
      },
    });
    expect((outcome2?.metadata as any)?.finalOutcome).toBe('FULLY_PROCESSED');

    // Clean up
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'CLOSED' },
    });
  });

  // -------------------------------------------------------------
  // B13: Injected failure and idempotency
  // -------------------------------------------------------------
  it('B13: injected failure on period 2 commits period 1 and fails, second run completes remaining periods', async () => {
    // 1 subscription with 3 due periods (Jan 1, Feb 1, Mar 1 with runDate Mar 15)
    const sub = await createSub(planMonthlyId, '2026-01-01');
    const runDate = parseBusinessDate('2026-03-15');

    // Injected failure on period index 1 (the 2nd period)
    const run1 = await runBilling(testUserId, {
      runDate,
      testOptions: {
        faultInjection: (sId, cycleIdx) => sId === sub.id && cycleIdx === 1,
      },
    });

    // Period 0 should have committed (1 invoice)
    const invoicesAfterRun1 = await prisma.invoice.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(invoicesAfterRun1.length).toBe(1);

    const outcome1 = await prisma.auditLog.findFirst({
      where: {
        billingRunId: run1.id,
        action: 'BILLING_OUTCOME',
        entityId: sub.id,
      },
    });
    expect((outcome1?.metadata as any)?.finalOutcome).toBe('FAILED');

    // Run 2: without fault injection completes remaining 2 periods
    const run2 = await runBilling(testUserId, { runDate });
    expect(run2.status).toBe('COMPLETED');

    const invoicesAfterRun2 = await prisma.invoice.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(invoicesAfterRun2.length).toBe(3);

    // Clean up
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'CLOSED' },
    });
  });

  // -------------------------------------------------------------
  // B14: Subscription lock rescan
  // -------------------------------------------------------------
  it('B14 Case A: lock released before rescan passes finish is picked up during rescan pass', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');
    const runDate = parseBusinessDate('2026-01-15');

    // We hold an explicit row lock in a transaction, release it when onMainPassComplete hook fires
    let releaseLock: () => void;
    const lockReleasedPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Start background lock holder
    const lockTxPromise = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Subscription" WHERE "id" = ${sub.id} FOR UPDATE
      `);
      // Wait until hook signals to release
      await lockReleasedPromise;
    });

    // Run billing with hook
    const run = await runBilling(testUserId, {
      runDate,
      hooks: {
        onMainPassComplete: async () => {
          releaseLock();
          await lockTxPromise;
        },
      },
    });

    expect(run.status).toBe('COMPLETED');
    const inv = await prisma.invoice.findFirst({
      where: { subscriptionId: sub.id },
    });
    expect(inv).not.toBeNull();

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'CLOSED' },
    });
  });

  it('B14 Case B: lock held throughout all rescan passes marks subscription as pending', async () => {
    const sub = await createSub(planMonthlyId, '2026-01-01');
    const runDate = parseBusinessDate('2026-01-15');

    let releaseLock: () => void;
    const lockReleasedPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Hold lock throughout entire billing run
    const lockTxPromise = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Subscription" WHERE "id" = ${sub.id} FOR UPDATE
      `);
      await lockReleasedPromise;
    });

    // Small delay to ensure lock is held
    await new Promise((r) => setTimeout(r, 100));

    const run = await runBilling(testUserId, { runDate });
    releaseLock!();
    await lockTxPromise;

    expect(run.status).toBe('COMPLETED_WITH_PENDING');
    expect(run.subscriptionsPending).toBeGreaterThanOrEqual(1);

    const inv = await prisma.invoice.findFirst({
      where: { subscriptionId: sub.id },
    });
    expect(inv).toBeNull();

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'CLOSED' },
    });
  });

  // -------------------------------------------------------------
  // B4 & B10: Invoice Confirmation Concurrency & Year Reset
  // -------------------------------------------------------------
  it('B4: concurrent confirmation of 10 draft invoices produces sequential numbers 1 to 10 with no gaps or duplicates', async () => {
    const draftInvoices: string[] = [];
    const issueDate = parseBusinessDate('2026-05-01');

    for (let i = 0; i < 10; i++) {
      const sub = await createSub(planMonthlyId, '2026-05-01');
      const inv = await prisma.invoice.create({
        data: {
          subscriptionId: sub.id,
          customerId,
          status: 'DRAFT',
          periodStart: issueDate,
          periodEnd: issueDate,
          issueDate,
          dueDate: issueDate,
          subtotal: '1000.00',
          discountTotal: '0.00',
          taxableTotal: '1000.00',
          taxTotal: '180.00',
          total: '1180.00',
          amountPaid: '0.00',
        },
      });
      draftInvoices.push(inv.id);
    }

    // Confirm all 10 concurrently
    await Promise.all(draftInvoices.map((id) => confirmInvoice(id, testUserId)));

    const confirmedInvoices = await prisma.invoice.findMany({
      where: { id: { in: draftInvoices } },
    });

    const numbers = confirmedInvoices.map((i) => i.number!).sort();
    expect(numbers.length).toBe(10);

    // Verify all follow INV-2026-XXXXXX and are sequential
    const numericParts = numbers.map((n) => {
      const match = n.match(/^INV-2026-(\d{6})$/);
      expect(match).not.toBeNull();
      return parseInt(match![1], 10);
    });

    // Check no duplicates
    const set = new Set(numericParts);
    expect(set.size).toBe(10);

    // Check sequential with no gaps
    for (let i = 1; i < numericParts.length; i++) {
      expect(numericParts[i]).toBe(numericParts[i - 1] + 1);
    }
  });

  it('B10: invoice sequence resets to 1 on the first confirmation of a new calendar year', async () => {
    const sub = await createSub(planMonthlyId, '2027-01-01');
    const issueDate2027 = parseBusinessDate('2027-01-01');

    const inv2027 = await prisma.invoice.create({
      data: {
        subscriptionId: sub.id,
        customerId,
        status: 'DRAFT',
        periodStart: issueDate2027,
        periodEnd: issueDate2027,
        issueDate: issueDate2027,
        dueDate: issueDate2027,
        subtotal: '1000.00',
        discountTotal: '0.00',
        taxableTotal: '1000.00',
        taxTotal: '180.00',
        total: '1180.00',
        amountPaid: '0.00',
      },
    });

    const confirmed = await confirmInvoice(inv2027.id, testUserId);
    expect(confirmed.number).toBe('INV-2027-000001');
  });

  // -------------------------------------------------------------
  // B6: Discount maxUses 1 under concurrent billing
  // -------------------------------------------------------------
  it('B6: discount with maxUses 1 under concurrent billing is used exactly once', async () => {
    const discount = await prisma.discount.create({
      data: {
        name: `Limited Discount ${Date.now()}`,
        kind: 'FIXED',
        value: new Decimal('100.00'),
        scope: 'PRODUCT',
        startsOn: parseBusinessDate('2026-01-01'),
        maxUses: 1,
        timesUsed: 0,
        isActive: true,
        products: {
          create: [{ productId: prodStandardId }],
        },
      },
    });

    // Two active subscriptions with the same product
    const sub1 = await createSub(planMonthlyId, '2026-06-01');
    const sub2 = await createSub(planMonthlyId, '2026-06-01');
    const runDate = parseBusinessDate('2026-06-15');

    // Concurrent billing runs
    await Promise.all([
      runBilling(testUserId, { runDate }),
      runBilling(testUserId, { runDate }),
    ]);

    // Check discount timesUsed
    const updatedDisc = await prisma.discount.findUnique({
      where: { id: discount.id },
    });
    expect(updatedDisc?.timesUsed).toBe(1);

    // Verify invoice discounts: exactly 1 invoice received this discount
    const appliedInvoiceDiscounts = await prisma.invoiceDiscount.findMany({
      where: { discountId: discount.id },
    });
    expect(appliedInvoiceDiscounts.length).toBe(1);
    expect(new Decimal(appliedInvoiceDiscounts[0].amount).equals(100)).toBe(true);
  });

  // -------------------------------------------------------------
  // B8: Historical Invoice Immutability
  // -------------------------------------------------------------
  it('B8: historical invoices do not change when product price or tax rate changes', async () => {
    // Generate an invoice via billing run
    const sub = await createSub(planMonthlyId, '2026-07-01');
    const runDate = parseBusinessDate('2026-07-15');

    await runBilling(testUserId, { runDate });

    const invoice = await prisma.invoice.findFirst({
      where: { subscriptionId: sub.id },
      include: { lines: true },
    });
    expect(invoice).not.toBeNull();
    expect(new Decimal(invoice!.subtotal).equals(1000)).toBe(true);
    expect(new Decimal(invoice!.taxTotal).equals(180)).toBe(true);
    expect(new Decimal(invoice!.total).equals(1180)).toBe(true);

    // Now modify the underlying Product price to 2,000 and Tax rate to 28%
    await prisma.product.update({
      where: { id: prodStandardId },
      data: { salesPrice: new Decimal('2000.00') },
    });

    await prisma.tax.update({
      where: { id: tax18Id },
      data: { ratePercent: new Decimal('28.00') },
    });

    // Re-fetch the previously generated invoice
    const refreshedInvoice = await prisma.invoice.findUnique({
      where: { id: invoice!.id },
      include: { lines: true },
    });

    expect(new Decimal(refreshedInvoice!.subtotal).equals(1000)).toBe(true);
    expect(new Decimal(refreshedInvoice!.taxTotal).equals(180)).toBe(true);
    expect(new Decimal(refreshedInvoice!.total).equals(1180)).toBe(true);
    expect(new Decimal(refreshedInvoice!.lines[0].unitPrice).equals(1000)).toBe(true);
    expect(new Decimal(refreshedInvoice!.lines[0].taxRatePercent).equals(18)).toBe(true);
  });
});
