import { requireUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { redirect } from 'next/navigation';
import { DiscountsClient } from '@/components/catalog/discounts-client';
import { DiscountKind, DiscountScope } from '@/lib/constants';

export default async function DiscountsPage() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  const discounts = await prisma.discount.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      products: true,
    },
  });

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const serialized = discounts.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind as DiscountKind,
    value: d.value.toString(),
    scope: d.scope as DiscountScope,
    minPurchaseAmount: d.minPurchaseAmount ? d.minPurchaseAmount.toString() : null,
    minQuantity: d.minQuantity,
    startsOn: d.startsOn.toISOString().split('T')[0],
    endsOn: d.endsOn ? d.endsOn.toISOString().split('T')[0] : null,
    maxUses: d.maxUses,
    timesUsed: d.timesUsed,
    isActive: d.isActive,
    productIds: d.products.map((p) => p.productId),
  }));

  return <DiscountsClient initialDiscounts={serialized} products={products} />;
}
