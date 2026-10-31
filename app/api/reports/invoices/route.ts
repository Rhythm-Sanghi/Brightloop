import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { parseBusinessDate } from '@/lib/dates/business-date';
import Decimal from 'decimal.js';

function sanitizeForCsv(val: string): string {
  if (!val) return '';
  const trimmed = val.trim();
  // Formula injection defense: prefix with single quote if starts with dangerous character
  if (['=', '+', '-', '@', '\t', '\r'].includes(trimmed[0])) {
    return `'${trimmed}`;
  }
  if (trimmed.includes(',') || trimmed.includes('"') || trimmed.includes('\n')) {
    return `"${trimmed.replace(/"/g, '""')}"`;
  }
  return trimmed;
}

export async function GET(req: NextRequest) {
  try {
    await requireStaffSession();

    const searchParams = req.nextUrl.searchParams;
    const fromStr = searchParams.get('from');
    const toStr = searchParams.get('to');

    const fromDate = fromStr ? parseBusinessDate(fromStr) : new Date(0);
    const toDate = toStr ? parseBusinessDate(toStr) : new Date('2099-12-31');

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

    const headers = [
      'InvoiceNumber',
      'CustomerName',
      'CustomerEmail',
      'IssueDate',
      'DueDate',
      'Subtotal',
      'DiscountTotal',
      'TaxableTotal',
      'TaxTotal',
      'Total',
      'AmountPaid',
      'Balance',
      'Status',
    ];

    const rows = invoices.map((inv) => {
      const totalDec = new Decimal(inv.total);
      const paidDec = new Decimal(inv.amountPaid);
      const balance = totalDec.minus(paidDec).toFixed(2);

      return [
        sanitizeForCsv(inv.number || 'DRAFT'),
        sanitizeForCsv(inv.customer.name),
        sanitizeForCsv(inv.customer.email),
        inv.issueDate.toISOString().split('T')[0],
        inv.dueDate.toISOString().split('T')[0],
        inv.subtotal.toString(),
        inv.discountTotal.toString(),
        inv.taxableTotal.toString(),
        inv.taxTotal.toString(),
        inv.total.toString(),
        inv.amountPaid.toString(),
        balance,
        inv.status,
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\r\n');

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="brightloop-invoices-${Date.now()}.csv"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unauthorized';
    return new NextResponse(JSON.stringify({ error: message }), { status: 401 });
  }
}
