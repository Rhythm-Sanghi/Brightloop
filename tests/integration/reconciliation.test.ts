import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/db/prisma';
import { Prisma } from '@prisma/client';
import { parseBusinessDate, todayBusinessDate, addDays } from '../../lib/dates/business-date';
import { calculateMRRandARR, SubscriptionForMRR } from '../../lib/calculations/mrr';
import { toDecimal, round2 } from '../../lib/money';
import Decimal from 'decimal.js';

describe('Milestone M7: Reconciliation Check (Non-Negotiable N8)', () => {
  let testUserId: string;
  let testCustId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Reconciliation Tester',
        email: `recon-tester-${Date.now()}@brightloop.demo`,
        passwordHash: 'dummy',
        role: 'STAFF',
      },
    });
    testUserId = user.id;

    const cust = await prisma.customer.create({
      data: {
        name: 'Reconciliation Customer',
        email: `recon-cust-${Date.now()}@brightloop.demo`,
      },
    });
    testCustId = cust.id;

    const plan = await prisma.plan.create({
      data: {
        name: `Recon Plan ${Date.now()}`,
        billingPeriod: 'MONTHLY',
        billingInterval: 1,
        availableFrom: parseBusinessDate('2026-01-01'),
      },
    });

    const sub = await prisma.subscription.create({
      data: {
        customerId: testCustId,
        planId: plan.id,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        paymentTermsDays: 15,
        createdById: testUserId,
      },
    });

    // Create an invoice with partial payment
    const issueDate = parseBusinessDate('2026-01-01');
    const inv = await prisma.invoice.create({
      data: {
        subscriptionId: sub.id,
        customerId: testCustId,
        status: 'CONFIRMED',
        number: `INV-RECON-${Date.now()}`,
        periodStart: issueDate,
        periodEnd: issueDate,
        issueDate,
        dueDate: issueDate,
        subtotal: '1000.00',
        discountTotal: '0.00',
        taxableTotal: '1000.00',
        taxTotal: '180.00',
        total: '1180.00',
        amountPaid: '500.00',
      },
    });

    await prisma.payment.create({
      data: {
        invoiceId: inv.id,
        amount: '500.00',
        method: 'BANK_TRANSFER',
        paidOn: issueDate,
        recordedById: testUserId,
      },
    });
  });

  it('N8 part 1: active subscriptions match direct SQL query', async () => {
    // Application query logic
    const activeSubs = await prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
    });

    // Direct SQL count
    const sqlRows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "Subscription"
      WHERE "status" = 'ACTIVE'
    `);

    expect(Number(sqlRows[0].count)).toBe(activeSubs.length);
  });

  it('N8 part 2: total collections match direct SQL SUM on payments', async () => {
    // App sum using Decimal.js
    const payments = await prisma.payment.findMany({
      select: { amount: true },
    });
    const appTotal = payments.reduce(
      (sum, p) => sum.plus(toDecimal(p.amount)),
      toDecimal(0)
    );

    // Direct SQL SUM
    const sqlRows = await prisma.$queryRaw<{ sum: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT COALESCE(SUM("amount"), 0) AS sum
      FROM "Payment"
    `);

    const sqlTotal = toDecimal(sqlRows[0].sum || 0);
    expect(appTotal.equals(sqlTotal)).toBe(true);
  });

  it('N8 part 3: confirmed invoice outstanding balances match direct SQL calculation', async () => {
    // App calculation
    const confirmed = await prisma.invoice.findMany({
      where: { status: 'CONFIRMED' },
      select: { total: true, amountPaid: true },
    });

    const appOutstanding = confirmed.reduce(
      (sum, inv) => sum.plus(toDecimal(inv.total).minus(toDecimal(inv.amountPaid))),
      toDecimal(0)
    );

    // Direct SQL
    const sqlRows = await prisma.$queryRaw<{ outstanding: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT COALESCE(SUM("total" - "amountPaid"), 0) AS outstanding
      FROM "Invoice"
      WHERE "status" = 'CONFIRMED'
    `);

    const sqlOutstanding = toDecimal(sqlRows[0].outstanding || 0);
    expect(appOutstanding.equals(sqlOutstanding)).toBe(true);
  });
});
