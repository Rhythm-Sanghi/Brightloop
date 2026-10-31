import { notFound } from 'next/navigation';
import { requireStaffSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { todayBusinessDate } from '@/lib/dates/business-date';
import { InvoiceDetailClient } from '@/components/invoices/invoice-detail-client';
import Decimal from 'decimal.js';

interface InvoiceDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function InvoiceDetailPage({ params }: InvoiceDetailPageProps) {
  await requireStaffSession();
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      subscription: {
        include: {
          plan: true,
        },
      },
      lines: {
        orderBy: { sortOrder: 'asc' },
        include: {
          product: true,
          variant: true,
        },
      },
      discounts: {
        include: {
          discount: true,
        },
      },
      payments: {
        orderBy: { createdAt: 'desc' },
        include: {
          recordedBy: { select: { name: true } },
        },
      },
    },
  });

  if (!invoice) {
    notFound();
  }

  const today = todayBusinessDate();
  const totalDec = new Decimal(invoice.total);
  const paidDec = new Decimal(invoice.amountPaid);
  const balanceDec = totalDec.minus(paidDec);

  const isOverdue =
    invoice.status === 'CONFIRMED' &&
    new Date(invoice.dueDate).getTime() < today.getTime() &&
    balanceDec.greaterThan(0);

  const formattedInvoice = {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    isOverdue,
    periodStart: new Date(invoice.periodStart).toISOString().split('T')[0],
    periodEnd: new Date(invoice.periodEnd).toISOString().split('T')[0],
    issueDate: new Date(invoice.issueDate).toISOString().split('T')[0],
    dueDate: new Date(invoice.dueDate).toISOString().split('T')[0],
    subtotal: invoice.subtotal.toString(),
    discountTotal: invoice.discountTotal.toString(),
    taxableTotal: invoice.taxableTotal.toString(),
    taxTotal: invoice.taxTotal.toString(),
    total: invoice.total.toString(),
    amountPaid: invoice.amountPaid.toString(),
    balance: balanceDec.toFixed(2),
    cancelledAt: invoice.cancelledAt ? new Date(invoice.cancelledAt).toISOString() : null,
    customer: {
      id: invoice.customer.id,
      name: invoice.customer.name,
      email: invoice.customer.email,
    },
    subscription: {
      id: invoice.subscription.id,
      number: invoice.subscription.number,
      plan: {
        name: invoice.subscription.plan.name,
      },
    },
    lines: invoice.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toString(),
      grossAmount: l.grossAmount.toString(),
      allocatedDiscount: l.allocatedDiscount.toString(),
      taxableAmount: l.taxableAmount.toString(),
      taxRatePercent: l.taxRatePercent.toString(),
      taxAmount: l.taxAmount.toString(),
      product: { name: l.product.name },
      variant: l.variant ? { name: `${l.variant.attribute}: ${l.variant.value}` } : null,
    })),
    discounts: invoice.discounts.map((d) => ({
      id: d.discountId,
      amount: d.amount.toString(),
      discount: {
        name: d.discount.name,
        kind: d.discount.kind,
        scope: d.discount.scope,
      },
    })),
    payments: invoice.payments.map((p) => ({
      id: p.id,
      amount: p.amount.toString(),
      method: p.method,
      paidOn: new Date(p.paidOn).toISOString().split('T')[0],
      note: p.note,
      recordedBy: { name: p.recordedBy.name },
    })),
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <InvoiceDetailClient invoice={formattedInvoice} />
    </div>
  );
}
