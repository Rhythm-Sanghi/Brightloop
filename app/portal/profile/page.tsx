import { requireCustomerSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { CustomerProfileClient } from '@/components/portal/profile-client';

export default async function CustomerProfilePage() {
  const session = await requireCustomerSession();

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      customer: true,
    },
  });

  if (!user) {
    return null;
  }

  const formattedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    customer: user.customer
      ? {
          companyName: user.customer.company,
          phone: user.customer.phone,
          address: user.customer.address,
        }
      : null,
  };

  return <CustomerProfileClient user={formattedUser} />;
}
