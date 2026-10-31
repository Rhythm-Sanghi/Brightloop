import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/guard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { logoutAction } from '@/app/actions/auth';
import { LayoutDashboard, Repeat, Receipt, CreditCard, User, LogOut } from 'lucide-react';

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/login');
  }

  if (user.mustChangePassword) {
    redirect('/change-password');
  }

  if (user.role !== 'CUSTOMER') {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <header className="h-16 px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center space-x-8">
          <Link href="/portal/overview" className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">
              B
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Brightloop Customer Portal
            </span>
          </Link>
          <nav className="hidden md:flex items-center space-x-1">
            <Link
              href="/portal/overview"
              className="px-3 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Overview
            </Link>
            <Link
              href="/portal/subscriptions"
              className="px-3 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              My Subscriptions
            </Link>
            <Link
              href="/portal/invoices"
              className="px-3 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              My Invoices
            </Link>
            <Link
              href="/portal/payments"
              className="px-3 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              My Payments
            </Link>
            <Link
              href="/portal/profile"
              className="px-3 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Profile
            </Link>
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          <div className="hidden sm:block text-right">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-200">{user.name}</p>
            <Badge variant="outline" className="text-xs">CUSTOMER</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={logoutAction}
            className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            <LogOut className="h-4 w-4 mr-1" /> Sign Out
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">{children}</main>
    </div>
  );
}
