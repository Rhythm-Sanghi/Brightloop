import { requireUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { TemplatesClient } from '@/components/catalog/templates-client';

export default async function TemplatesPage() {
  const user = await requireUser();
  const canEdit = user.role === 'ADMIN';

  const templates = await prisma.quotationTemplate.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      plan: true,
      lines: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
  });

  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: {
      variants: { where: { isActive: true } },
    },
  });

  const serialized = templates.map((t) => ({
    id: t.id,
    name: t.name,
    planId: t.planId,
    planName: t.plan.name,
    validityDays: t.validityDays,
    notes: t.notes,
    lines: t.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.product.name,
      variantId: l.variantId,
      variantName: l.variant ? `${l.variant.attribute}: ${l.variant.value}` : null,
      quantity: l.quantity,
    })),
  }));

  const serializedProducts = products.map((p) => ({
    id: p.id,
    name: p.name,
    variants: p.variants.map((v) => ({
      id: v.id,
      attribute: v.attribute,
      value: v.value,
    })),
  }));

  return (
    <TemplatesClient
      initialTemplates={serialized}
      plans={plans}
      products={serializedProducts}
      canEdit={canEdit}
    />
  );
}
