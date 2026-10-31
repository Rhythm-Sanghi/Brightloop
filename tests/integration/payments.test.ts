import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/db/prisma';
import { parseBusinessDate } from '../../lib/dates/business-date';
import { recordPayment } from '../../lib/services/payments';
import { confirmInvoice } from '../../lib/services/invoices';
import { AppError } from '../../lib/errors';
import Decimal from 'decimal.js';

describe('Milestone M5: Payments & Invoices (Integration)', () => {
  let staffUserId: string;
  let customerId: string;
  let prodId: string;
  let planId: string;

  beforeAll(async () => {
    // 1. Staff user
    const user = await prisma.user.create({
      data: {
        name: 'Payment Tester',
        email: `payment-tester-${Date.now()}@brightloop.demo`,
        passwordHash: 'dummy',
        role: 'STAFF',
      },
    });
    staffUserId = user.id;

    // 2. Customer
    const cust = await prisma.customer.create({
      data: {
        name: 'Payment Test Customer',
        email: `pay-cust-${Date.now()}@brightloop.demo`,
      },
    });
    customerId = cust.id;

    // 3. Product
    const prod = await prisma.product.create({
      data: {
        name: `Payment Product ${Date.now()}`,
        type: 'SERVICE',
        salesPrice: new Decimal('1000.00'),
        costPrice: new Decimal('500.00'),
      },
    });
    prodId = prod.id;

    // 4. Plan
    const plan = await prisma.plan.create({
      data: {
        name: `Payment Plan ${Date.now()}`,
        billingPeriod: 'MONTHLY',
        billingInterval: 1,
        availableFrom: parseBusinessDate('2026-01-01'),
      },
    });
    planId = plan.id;
  });

  // -------------------------------------------------------------
  // B3: Concurrent payments cannot exceed outstanding balance
  // -------------------------------------------------------------
  it('B3: two concurrent payments of 800 against balance 1,000 result in one success and one OVERPAYMENT', async () => {
    const sub = await prisma.subscription.create({
      data: {
        customerId,
        planId,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        paymentTermsDays: 15,
        createdById: staffUserId,
      },
    });

    const issueDate = parseBusinessDate('2026-01-01');
    const invoice = await prisma.invoice.create({
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
        taxTotal: '0.00',
        total: '1000.00',
        amountPaid: '0.00',
        lines: {
          create: [
            {
              productId: prodId,
              description: 'Payment Test Line',
              quantity: 1,
              unitPrice: '1000.00',
              grossAmount: '1000.00',
              allocatedDiscount: '0.00',
              taxableAmount: '1000.00',
              taxRatePercent: '0.00',
              taxAmount: '0.00',
              sortOrder: 0,
            },
          ],
        },
      },
    });

    // Confirm invoice so status is CONFIRMED
    const confirmed = await confirmInvoice(invoice.id, staffUserId);
    expect(confirmed.status).toBe('CONFIRMED');

    // Run 2 concurrent payments of 800
    const paymentPromises = [
      recordPayment({
        invoiceId: confirmed.id,
        amount: '800.00',
        method: 'BANK_TRANSFER',
        paidOn: issueDate,
        recordedById: staffUserId,
        todayOverride: issueDate,
      }),
      recordPayment({
        invoiceId: confirmed.id,
        amount: '800.00',
        method: 'UPI',
        paidOn: issueDate,
        recordedById: staffUserId,
        todayOverride: issueDate,
      }),
    ];

    const results = await Promise.allSettled(paymentPromises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed and one must be rejected with OVERPAYMENT
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectionReason).toBeInstanceOf(AppError);
    expect((rejectionReason as AppError).code).toBe('OVERPAYMENT');

    // Verify DB state
    const refreshedInvoice = await prisma.invoice.findUnique({
      where: { id: confirmed.id },
    });
    expect(refreshedInvoice).not.toBeNull();
    expect(new Decimal(refreshedInvoice!.amountPaid).equals(800)).toBe(true);
    expect(refreshedInvoice!.status).toBe('CONFIRMED');

    const paymentRows = await prisma.payment.findMany({
      where: { invoiceId: confirmed.id },
    });
    expect(paymentRows.length).toBe(1);
    expect(new Decimal(paymentRows[0].amount).equals(800)).toBe(true);

    // Clean up
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'CLOSED' },
    });
  });
});
