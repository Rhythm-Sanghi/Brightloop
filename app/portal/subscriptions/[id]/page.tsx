import { notFound } from 'next/navigation';
import { requireCustomerSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { PortalSubscriptionDetailClient } from '@/components/portal/subscription-detail-client';

interface PortalSubscriptionDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PortalSubscriptionDetailPage({
  params,
}: PortalSubscriptionDetailPageProps) {
  const session = await requireCustomerSession();
  const { id } = await params;

  // Strict ownership check: customerId MUST match session.customerId
  const subscription = await prisma.subscription.findFirst({
    where: {
      id,
      customerId: session.customerId,
    },
    include: {
      plan: true,
      lines: {
        include: {
          product: true,
          variant: true,
        },
      },
      requests: {
        where: { status: 'PENDING' },
        take: 1,
      },
    },
  });

  if (!subscription) {
    notFound();
  }

  const formattedSub = {
    id: subscription.id,
    number: subscription.number,
    status: subscription.status,
    startDate: new Date(subscription.startDate).toISOString().split('T')[0],
    expiryDate: subscription.expiryDate
      ? new Date(subscription.expiryDate).toISOString().split('T')[0]
      : null,
    nextBillingDate: subscription.nextBillingDate
      ? new Date(subscription.nextBillingDate).toISOString().split('T')[0]
      : null,
    renewalCount: subscription.renewalCount,
    paymentTermsDays: subscription.paymentTermsDays,
    plan: {
      name: subscription.plan.name,
      billingPeriod: subscription.plan.billingPeriod,
      billingInterval: subscription.plan.billingInterval,
      allowPause: subscription.plan.allowPause,
      allowRenewal: subscription.plan.allowRenewal,
      allowEarlyClose: subscription.plan.allowEarlyClose,
    },
    lines: subscription.lines.map((l) => ({
      id: l.id,
      productName: l.product.name,
      variantName: l.variant ? `${l.variant.attribute}: ${l.variant.value}` : null,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toString(),
    })),
    pendingRequest:
      subscription.requests.length > 0
        ? {
            id: subscription.requests[0].id,
            requestType: subscription.requests[0].requestType,
            requestedAt: new Date(subscription.requests[0].requestedAt)
              .toISOString()
              .split('T')[0],
            customerNote: subscription.requests[0].customerNote,
          }
        : null,
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <PortalSubscriptionDetailClient subscription={formattedSub} />
    </div>
  );
}
