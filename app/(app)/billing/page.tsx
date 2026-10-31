import { requireStaffSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { BillingClient } from '@/components/billing/billing-client';

export default async function BillingPage() {
  await requireStaffSession();

  const runs = await prisma.billingRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 20,
    include: {
      startedBy: {
        select: { name: true, email: true },
      },
    },
  });

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <BillingClient initialRuns={runs} />
    </div>
  );
}
