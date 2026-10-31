import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';

export default async function HomePage() {
  try {
    const user = await requireUser();
    if (user.role === 'CUSTOMER') {
      redirect('/portal/overview');
    } else {
      redirect('/dashboard');
    }
  } catch {
    redirect('/login');
  }
}
