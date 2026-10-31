import { requireUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { PlansClient } from '@/components/catalog/plans-client';

export default async function PlansPage() {
  const user = await requireUser();
  const canEdit = user.role === 'ADMIN';

  const plans = await prisma.plan.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const serialized = plans.map((p) => ({
    id: p.id,
    name: p.name,
    billingPeriod: p.billingPeriod,
    billingInterval: p.billingInterval,
    minimumQuantity: p.minimumQuantity,
    availableFrom: p.availableFrom.toISOString().split('T')[0],
    availableUntil: p.availableUntil ? p.availableUntil.toISOString().split('T')[0] : null,
    paymentTermsDays: p.paymentTermsDays,
    autoCloseOnExpiry: p.autoCloseOnExpiry,
    allowEarlyClose: p.allowEarlyClose,
    allowPause: p.allowPause,
    allowRenewal: p.allowRenewal,
    isActive: p.isActive,
  }));

  return <PlansClient initialPlans={serialized} canEdit={canEdit} />;
}
