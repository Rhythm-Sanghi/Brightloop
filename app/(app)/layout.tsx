import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { AppSidebar } from '@/components/layout/app-sidebar';

export default async function AppLayout({
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

  if (user.role === 'CUSTOMER') {
    redirect('/portal/overview');
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppSidebar user={user} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center space-x-3">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Workspace / {user.role === 'ADMIN' ? 'Administration' : 'Staff Operations'}
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <span className="text-xs text-slate-400">Timezone</span>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Asia/Kolkata (UTC+5:30)</p>
            </div>
          </div>
        </header>
        <main className="flex-1 p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
