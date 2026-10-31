import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors';
import { reserveInvoiceNumber } from './numbering';
import { createAuditLog } from './audit';
import { queueSimulatedEmail } from './outbox';
import { toDecimal } from '../money';

export async function confirmInvoice(invoiceId: string, actorId?: string | null) {
  return prisma.$transaction(async (tx) => {
    // 1. SELECT ... FOR UPDATE
    const rows = await tx.$queryRaw<
      {
        id: string;
        status: string;
        issueDate: Date;
        total: Prisma.Decimal;
      }[]
    >(Prisma.sql`
      SELECT "id", "status", "issueDate", "total"
      FROM "Invoice"
      WHERE "id" = ${invoiceId}
      FOR UPDATE
    `);

    if (!rows || rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Invoice not found.', 404);
    }
    const inv = rows[0];

    // 2. Status must be DRAFT
    if (inv.status !== 'DRAFT') {
      throw new AppError('INVOICE_NOT_CONFIRMED', `Invoice is already in ${inv.status} status.`, 409);
    }

    // 3. Reserve invoice number
    const issueYear = new Date(inv.issueDate).getUTCFullYear();
    const invoiceNumber = await reserveInvoiceNumber(tx, issueYear);

    // 4. Set status CONFIRMED (or PAID if total is zero)
    const isZeroTotal = toDecimal(inv.total).equals(0);
    const toStatus = isZeroTotal ? 'PAID' : 'CONFIRMED';
    const amountPaid = isZeroTotal ? '0.00' : undefined;

    const updated = await tx.invoice.update({
      where: { id: inv.id },
      data: {
        number: invoiceNumber,
        status: toStatus,
        confirmedAt: new Date(),
        ...(amountPaid !== undefined ? { amountPaid } : {}),
      },
    });

    // 5. Audit row
    await createAuditLog(
      {
        actorId: actorId ?? null,
        action: 'INVOICE_CONFIRMED',
        entityType: 'Invoice',
        entityId: inv.id,
        fromStatus: 'DRAFT',
        toStatus,
        metadata: { invoiceNumber, isZeroTotal },
      },
      tx
    );

    return updated;
  });
}

export async function cancelInvoice(
  invoiceId: string,
  actorId?: string | null,
  closeReason?: string | null
) {
  return prisma.$transaction(async (tx) => {
    // Lock invoice row first (section 5.7)
    const rows = await tx.$queryRaw<
      {
        id: string;
        status: string;
        amountPaid: Prisma.Decimal;
      }[]
    >(Prisma.sql`
      SELECT "id", "status", "amountPaid"
      FROM "Invoice"
      WHERE "id" = ${invoiceId}
      FOR UPDATE
    `);

    if (!rows || rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Invoice not found.', 404);
    }
    const inv = rows[0];

    // Allowed from DRAFT, or from CONFIRMED when amountPaid is zero
    if (inv.status !== 'DRAFT' && inv.status !== 'CONFIRMED') {
      throw new AppError('INVOICE_NOT_CANCELLABLE', `Cannot cancel invoice in ${inv.status} status.`, 422);
    }

    if (inv.status === 'CONFIRMED' && toDecimal(inv.amountPaid).greaterThan(0)) {
      throw new AppError('INVOICE_NOT_CANCELLABLE', 'Cannot cancel invoice with recorded payments.', 422);
    }

    // Set cancelledAt and status CANCELLED
    const updated = await tx.invoice.update({
      where: { id: inv.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    // Release usage for each distinct InvoiceDiscount row
    const invoiceDiscounts = await tx.invoiceDiscount.findMany({
      where: { invoiceId: inv.id },
    });

    for (const idisc of invoiceDiscounts) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Discount"
        SET "timesUsed" = "timesUsed" - 1
        WHERE "id" = ${idisc.discountId} AND "timesUsed" > 0
      `);
    }

    // Write audit row
    await createAuditLog(
      {
        actorId: actorId ?? null,
        action: 'INVOICE_CANCELLED',
        entityType: 'Invoice',
        entityId: inv.id,
        fromStatus: inv.status,
        toStatus: 'CANCELLED',
        metadata: { closeReason },
      },
      tx
    );

    return updated;
  });
}

export async function sendInvoiceToOutbox(invoiceId: string, actorId?: string | null) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { customer: true, subscription: true },
  });

  if (!inv) {
    throw new AppError('NOT_FOUND', 'Invoice not found.', 404);
  }

  if (inv.status !== 'CONFIRMED' && inv.status !== 'PAID') {
    throw new AppError('INVOICE_NOT_CONFIRMED', 'Only confirmed or paid invoices can be sent.', 422);
  }

  const outbox = await queueSimulatedEmail({
    toAddress: inv.customer.email,
    subject: `Brightloop Invoice ${inv.number || inv.id}`,
    body: `Dear ${inv.customer.name},\n\nPlease find your invoice ${inv.number || inv.id} for subscription ${inv.subscription.number || inv.subscription.id}.\nTotal Amount: ₹${inv.total}\nDue Date: ${inv.dueDate.toISOString().split('T')[0]}\n\nSimulated delivery: not sent.`,
    kind: 'INVOICE_SENT',
  });

  await createAuditLog({
    actorId: actorId ?? null,
    action: 'INVOICE_SENT',
    entityType: 'Invoice',
    entityId: inv.id,
    metadata: { outboxId: outbox.id, toAddress: inv.customer.email },
  });

  return outbox;
}
