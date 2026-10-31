import { requireUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { redirect } from 'next/navigation';
import { TaxesClient } from '@/components/catalog/taxes-client';

export default async function TaxesPage() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  const taxes = await prisma.tax.findMany({
    orderBy: { ratePercent: 'desc' },
  });

  const serialized = taxes.map((t) => ({
    id: t.id,
    name: t.name,
    ratePercent: t.ratePercent.toString(),
    isActive: t.isActive,
  }));

  return <TaxesClient initialTaxes={serialized} />;
}
