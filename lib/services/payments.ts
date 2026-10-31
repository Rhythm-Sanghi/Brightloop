import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors';
import { PaymentMethod, PAYMENT_METHODS } from '../constants';
import { round2, toDecimal } from '../money';
import { todayBusinessDate } from '../dates/business-date';
import { createAuditLog } from './audit';

export interface RecordPaymentInput {
  invoiceId: string;
  amount: string | number;
  method: PaymentMethod;
  paidOn: Date;
  note?: string | null;
  recordedById: string;
  todayOverride?: Date;
  asOfDate?: Date;
  auditAt?: Date;
}

export async function recordPayment(input: RecordPaymentInput) {
  const today = input.asOfDate || input.todayOverride || todayBusinessDate();
  const paymentAmount = round2(toDecimal(input.amount));

  if (!paymentAmount.greaterThan(0)) {
    throw new AppError('VALIDATION_FAILED', 'Payment amount must be greater than zero.', 422);
  }

  if (input.paidOn.getTime() > today.getTime()) {
    throw new AppError('VALIDATION_FAILED', 'Payment date cannot be in the future.', 422);
  }

  if (!PAYMENT_METHODS.includes(input.method)) {
    throw new AppError('VALIDATION_FAILED', `Invalid payment method: ${input.method}`, 422);
  }

  return prisma.$transaction(async (tx) => {
    // 1. Lock invoice row
    const lockedRows = await tx.$queryRaw<
      {
        id: string;
        status: string;
        total: Prisma.Decimal;
      }[]
    >(Prisma.sql`
      SELECT "id", "status", "total"
      FROM "Invoice"
      WHERE "id" = ${input.invoiceId}
      FOR UPDATE
    `);

    if (!lockedRows || lockedRows.length === 0) {
      throw new AppError('NOT_FOUND', 'Invoice not found.', 404);
    }
    const inv = lockedRows[0];

    // 2. Reject if status is not CONFIRMED
    if (inv.status !== 'CONFIRMED') {
      throw new AppError('INVOICE_NOT_CONFIRMED', `Cannot record payment for invoice in ${inv.status} status.`, 422);
    }

    // 3. Recompute amountPaid as sum of Payment rows
    const paymentRows = await tx.payment.findMany({
      where: { invoiceId: inv.id },
      select: { amount: true },
    });
    const currentPaid = paymentRows.reduce(
      (sum, p) => sum.plus(toDecimal(p.amount)),
      toDecimal(0)
    );

    // 4. Compute outstanding
    const invoiceTotal = toDecimal(inv.total);
    const outstanding = round2(invoiceTotal.minus(currentPaid));

    // 5. Validate amount
    if (paymentAmount.greaterThan(outstanding)) {
      throw new AppError(
        'OVERPAYMENT',
        `Payment amount (₹${paymentAmount.toFixed(2)}) exceeds outstanding balance (₹${outstanding.toFixed(2)}).`,
        422,
        { outstanding: outstanding.toFixed(2), requested: paymentAmount.toFixed(2) }
      );
    }

    // 6. Insert Payment
    const payment = await tx.payment.create({
      data: {
        invoiceId: inv.id,
        amount: paymentAmount.toString(),
        method: input.method,
        paidOn: input.paidOn,
        note: input.note || null,
        recordedById: input.recordedById,
        ...(input.auditAt || input.asOfDate ? { createdAt: input.auditAt || input.asOfDate } : {}),
      },
    });

    // 7. Recompute amountPaid and store it
    const newPaid = round2(currentPaid.plus(paymentAmount));
    const isFullyPaid = newPaid.equals(invoiceTotal);
    const toStatus = isFullyPaid ? 'PAID' : 'CONFIRMED';

    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        amountPaid: newPaid.toString(),
        status: toStatus,
      },
    });

    // 9. Write audit row
    await createAuditLog(
      {
        actorId: input.recordedById,
        action: 'PAYMENT_RECORDED',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: {
          invoiceId: inv.id,
          amount: paymentAmount.toFixed(2),
          method: input.method,
          newAmountPaid: newPaid.toFixed(2),
          invoiceStatus: toStatus,
        },
        auditAt: input.auditAt || input.asOfDate,
      },
      tx
    );

    if (isFullyPaid) {
      await createAuditLog(
        {
          actorId: input.recordedById,
          action: 'INVOICE_PAID',
          entityType: 'Invoice',
          entityId: inv.id,
          fromStatus: 'CONFIRMED',
          toStatus: 'PAID',
          metadata: { total: invoiceTotal.toFixed(2) },
          auditAt: input.auditAt || input.asOfDate,
        },
        tx
      );
    }

    return {
      payment,
      newAmountPaid: newPaid.toFixed(2),
      isFullyPaid,
      invoiceStatus: toStatus,
    };
  });
}
