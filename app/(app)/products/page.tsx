import { requireUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { ProductsClient } from '@/components/catalog/products-client';

export default async function ProductsPage() {
  const user = await requireUser();
  const canEdit = user.role === 'ADMIN';

  const products = await prisma.product.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      defaultTax: true,
      variants: { where: { isActive: true } },
    },
  });

  const taxes = await prisma.tax.findMany({
    where: { isActive: true },
  });

  const serialized = products.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    salesPrice: p.salesPrice.toString(),
    costPrice: p.costPrice.toString(),
    isActive: p.isActive,
    defaultTax: p.defaultTax ? { name: p.defaultTax.name, ratePercent: p.defaultTax.ratePercent.toString() } : null,
    variants: p.variants.map((v) => ({
      id: v.id,
      attribute: v.attribute,
      value: v.value,
      priceAdjustment: v.priceAdjustment.toString(),
    })),
  }));

  const serializedTaxes = taxes.map((t) => ({
    id: t.id,
    name: t.name,
    ratePercent: t.ratePercent.toString(),
  }));

  return <ProductsClient initialProducts={serialized} taxes={serializedTaxes} canEdit={canEdit} />;
}
