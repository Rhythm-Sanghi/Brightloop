import { requireStaffSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { PaymentsClient, PaymentListItem } from '@/components/payments/payments-client';
import Decimal from 'decimal.js';

export default async function PaymentsPage() {
  await requireStaffSession();

  const payments = await prisma.payment.findMany({
    orderBy: { paidOn: 'desc' },
    include: {
      recordedBy: { select: { name: true } },
      invoice: {
        select: {
          id: true,
          number: true,
          customer: {
            select: { name: true, email: true },
          },
        },
      },
    },
  });

  let totalCollectedDec = new Decimal(0);
  const formattedPayments: PaymentListItem[] = payments.map((p) => {
    const amountDec = new Decimal(p.amount);
    totalCollectedDec = totalCollectedDec.plus(amountDec);

    return {
      id: p.id,
      amount: p.amount.toString(),
      method: p.method,
      paidOn: new Date(p.paidOn).toISOString().split('T')[0],
      note: p.note,
      recordedAt: new Date(p.createdAt).toISOString(),
      recordedBy: { name: p.recordedBy.name },
      invoice: {
        id: p.invoice.id,
        number: p.invoice.number,
        customer: {
          name: p.invoice.customer.name,
          email: p.invoice.customer.email,
        },
      },
    };
  });

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <PaymentsClient
        initialPayments={formattedPayments}
        totalCollected={totalCollectedDec.toFixed(2)}
      />
    </div>
  );
}
