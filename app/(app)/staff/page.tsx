import { requireUser, requireRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { StaffClient } from '@/components/staff/staff-client';
import { redirect } from 'next/navigation';

export default async function StaffPage() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  const staffUsers = await prisma.user.findMany({
    where: { role: 'STAFF' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });

  const serialized = staffUsers.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
  }));

  return <StaffClient initialStaff={serialized} />;
}
