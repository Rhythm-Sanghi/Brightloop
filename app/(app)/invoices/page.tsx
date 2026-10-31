import { requireStaffSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { todayBusinessDate } from '@/lib/dates/business-date';
import { InvoicesClient, InvoiceListItem } from '@/components/invoices/invoices-client';
import Decimal from 'decimal.js';

export default async function InvoicesPage() {
  await requireStaffSession();

  const today = todayBusinessDate();

  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      subscription: { select: { id: true, number: true } },
    },
  });

  const formattedInvoices: InvoiceListItem[] = invoices.map((inv) => {
    const totalDec = new Decimal(inv.total);
    const paidDec = new Decimal(inv.amountPaid);
    const balanceDec = totalDec.minus(paidDec);

    const isOverdue =
      inv.status === 'CONFIRMED' &&
      new Date(inv.dueDate).getTime() < today.getTime() &&
      balanceDec.greaterThan(0);

    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      isOverdue,
      issueDate: new Date(inv.issueDate).toISOString().split('T')[0],
      dueDate: new Date(inv.dueDate).toISOString().split('T')[0],
      subtotal: inv.subtotal.toString(),
      taxTotal: inv.taxTotal.toString(),
      total: inv.total.toString(),
      amountPaid: inv.amountPaid.toString(),
      balance: balanceDec.toFixed(2),
      customer: {
        id: inv.customer.id,
        name: inv.customer.name,
        email: inv.customer.email,
      },
      subscription: {
        id: inv.subscription.id,
        number: inv.subscription.number,
      },
    };
  });

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <InvoicesClient initialInvoices={formattedInvoices} />
    </div>
  );
}
