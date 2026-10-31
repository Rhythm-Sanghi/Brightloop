import { requireStaffSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { todayBusinessDate, addDays, parseBusinessDate } from '@/lib/dates/business-date';
import { ReportsClient } from '@/components/reports/reports-client';
import Decimal from 'decimal.js';

interface ReportsPageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  await requireStaffSession();
  const sp = await searchParams;

  const today = todayBusinessDate();
  const defaultFrom = addDays(today, -30).toISOString().split('T')[0];
  const defaultTo = today.toISOString().split('T')[0];

  const fromStr = sp.from || defaultFrom;
  const toStr = sp.to || defaultTo;

  const fromDate = parseBusinessDate(fromStr);
  const toDate = parseBusinessDate(toStr);

  // Invoices in range
  const invoices = await prisma.invoice.findMany({
    where: {
      issueDate: {
        gte: fromDate,
        lte: toDate,
      },
    },
    orderBy: { issueDate: 'desc' },
    include: {
      customer: { select: { name: true, email: true } },
    },
  });

  // Payments in range
  const payments = await prisma.payment.findMany({
    where: {
      paidOn: {
        gte: fromDate,
        lte: toDate,
      },
    },
    select: { amount: true },
  });

  // Calculate reconciled totals using Decimal.js
  let totalInvoicedDec = new Decimal(0);
  let totalDiscountsDec = new Decimal(0);
  let totalTaxDec = new Decimal(0);
  let totalOutstandingDec = new Decimal(0);

  const formattedInvoices = invoices.map((inv) => {
    const totalDec = new Decimal(inv.total);
    const paidDec = new Decimal(inv.amountPaid);
    const balanceDec = totalDec.minus(paidDec);

    if (inv.status !== 'CANCELLED') {
      totalInvoicedDec = totalInvoicedDec.plus(totalDec);
      totalDiscountsDec = totalDiscountsDec.plus(new Decimal(inv.discountTotal));
      totalTaxDec = totalTaxDec.plus(new Decimal(inv.taxTotal));
      if (inv.status === 'CONFIRMED') {
        totalOutstandingDec = totalOutstandingDec.plus(balanceDec);
      }
    }

    return {
      id: inv.id,
      number: inv.number,
      customerName: inv.customer.name,
      customerEmail: inv.customer.email,
      issueDate: new Date(inv.issueDate).toISOString().split('T')[0],
      dueDate: new Date(inv.dueDate).toISOString().split('T')[0],
      subtotal: inv.subtotal.toString(),
      discountTotal: inv.discountTotal.toString(),
      taxTotal: inv.taxTotal.toString(),
      total: inv.total.toString(),
      amountPaid: inv.amountPaid.toString(),
      balance: balanceDec.toFixed(2),
      status: inv.status,
    };
  });

  let totalCollectedDec = new Decimal(0);
  for (const p of payments) {
    totalCollectedDec = totalCollectedDec.plus(new Decimal(p.amount));
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <ReportsClient
        initialFrom={fromStr}
        initialTo={toStr}
        invoices={formattedInvoices}
        totals={{
          totalInvoiced: totalInvoicedDec.toFixed(2),
          totalCollected: totalCollectedDec.toFixed(2),
          totalOutstanding: totalOutstandingDec.toFixed(2),
          totalTax: totalTaxDec.toFixed(2),
          totalDiscounts: totalDiscountsDec.toFixed(2),
        }}
      />
    </div>
  );
}
