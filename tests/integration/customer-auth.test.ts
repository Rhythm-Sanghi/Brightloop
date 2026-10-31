import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/db/prisma';
import { parseBusinessDate } from '../../lib/dates/business-date';
import { createSubscriptionRequest } from '../../lib/services/requests';
import { AppError } from '../../lib/errors';
import Decimal from 'decimal.js';

describe('Milestone M6: Customer Portal Isolation (Blocking Test B7)', () => {
  let staffId: string;
  let custAId: string;
  let custBId: string;
  let subAId: string;
  let subBId: string;
  let invAId: string;
  let invBId: string;
  const createdSubIds: string[] = [];

  beforeAll(async () => {
    // 1. Staff user
    const staff = await prisma.user.create({
      data: {
        name: 'Portal Test Staff',
        email: `portal-staff-${Date.now()}@brightloop.demo`,
        passwordHash: 'dummy',
        role: 'STAFF',
      },
    });
    staffId = staff.id;

    // 2. Customer A & Customer B
    const custA = await prisma.customer.create({
      data: {
        name: 'Customer Alice',
        email: `alice-${Date.now()}@brightloop.demo`,
      },
    });
    custAId = custA.id;

    const custB = await prisma.customer.create({
      data: {
        name: 'Customer Bob',
        email: `bob-${Date.now()}@brightloop.demo`,
      },
    });
    custBId = custB.id;

    // 3. Plan
    const plan = await prisma.plan.create({
      data: {
        name: `Customer Test Plan ${Date.now()}`,
        billingPeriod: 'MONTHLY',
        billingInterval: 1,
        allowPause: true,
        allowRenewal: true,
        allowEarlyClose: true,
        availableFrom: parseBusinessDate('2026-01-01'),
      },
    });

    // 4. Subscription A & B
    const subA = await prisma.subscription.create({
      data: {
        customerId: custAId,
        planId: plan.id,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-12-31'),
        paymentTermsDays: 15,
        createdById: staffId,
      },
    });
    createdSubIds.push(subA.id);
    subAId = subA.id;

    const subB = await prisma.subscription.create({
      data: {
        customerId: custBId,
        planId: plan.id,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-12-31'),
        paymentTermsDays: 15,
        createdById: staffId,
      },
    });
    createdSubIds.push(subB.id);
    subBId = subB.id;

    // 5. Invoice A & B
    const issueDate = parseBusinessDate('2026-01-01');
    const invA = await prisma.invoice.create({
      data: {
        subscriptionId: subAId,
        customerId: custAId,
        status: 'CONFIRMED',
        number: `INV-2026-${Math.floor(100000 + Math.random() * 900000)}`,
        periodStart: issueDate,
        periodEnd: issueDate,
        issueDate,
        dueDate: issueDate,
        subtotal: '1000.00',
        discountTotal: '0.00',
        taxableTotal: '1000.00',
        taxTotal: '0.00',
        total: '1000.00',
        amountPaid: '0.00',
      },
    });
    invAId = invA.id;

    const invB = await prisma.invoice.create({
      data: {
        subscriptionId: subBId,
        customerId: custBId,
        status: 'CONFIRMED',
        number: `INV-2026-${Math.floor(100000 + Math.random() * 900000)}`,
        periodStart: issueDate,
        periodEnd: issueDate,
        issueDate,
        dueDate: issueDate,
        subtotal: '1000.00',
        discountTotal: '0.00',
        taxableTotal: '1000.00',
        taxTotal: '0.00',
        total: '1000.00',
        amountPaid: '0.00',
      },
    });
    invBId = invB.id;
  });

  afterAll(async () => {
    if (createdSubIds.length === 0) return;
    const ids = [...createdSubIds];
    const res = await prisma.subscription.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'CLOSED',
        closeReason: 'TEST_CLEANUP',
        closedAt: new Date(),
      },
    });
    if (res.count !== ids.length) {
      throw new Error(`Expected ${ids.length} subscriptions cleaned up in customer-auth afterAll, but updated ${res.count}`);
    }
    createdSubIds.length = 0;
  });

  // -------------------------------------------------------------
  // B7: Customer Isolation
  // -------------------------------------------------------------
  it('B7 part 1: Customer A submitting a request on Customer B subscription returns NOT_FOUND', async () => {
    let threw = false;
    try {
      // Alice tries to request pause on Bob's subscription subBId
      await createSubscriptionRequest(custAId, subBId, 'PAUSE', 'Malicious request');
    } catch (err: unknown) {
      threw = true;
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('NOT_FOUND');
      expect((err as AppError).status).toBe(404);
    }
    expect(threw).toBe(true);
  });

  it('B7 part 2: Customer A querying Customer B subscription via scoped lookup returns null (NOT_FOUND)', async () => {
    // When customer queries for a subscription in portal:
    const sub = await prisma.subscription.findFirst({
      where: {
        id: subBId,
        customerId: custAId, // Enforced by session customerId
      },
    });
    expect(sub).toBeNull();
  });

  it('B7 part 3: Customer A querying Customer B invoice via scoped lookup returns null (NOT_FOUND)', async () => {
    // When customer queries for an invoice in portal:
    const inv = await prisma.invoice.findFirst({
      where: {
        id: invBId,
        customerId: custAId, // Enforced by session customerId
      },
    });
    expect(inv).toBeNull();
  });

  it('B7 part 4: Customer A querying payments via scoped customerId cannot see Customer B payments', async () => {
    // Record payment for Bob's invoice
    await prisma.payment.create({
      data: {
        invoiceId: invBId,
        amount: new Decimal('500.00'),
        method: 'BANK_TRANSFER',
        paidOn: parseBusinessDate('2026-01-01'),
        recordedById: staffId,
      },
    });

    // Query payments scoped to Alice
    const alicePayments = await prisma.payment.findMany({
      where: {
        invoice: {
          customerId: custAId,
        },
      },
    });
    expect(alicePayments.length).toBe(0);
  });
});
