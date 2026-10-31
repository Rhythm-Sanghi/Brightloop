'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Role } from '@/lib/constants';
import { can } from '@/lib/permissions';
import {
  LayoutDashboard,
  Users,
  Package,
  Layers,
  FileText,
  Percent,
  Receipt,
  Repeat,
  CreditCard,
  BarChart3,
  History,
  Mail,
  UserCheck,
  Settings,
  Landmark,
  Inbox,
  LogOut,
  Moon,
  Sun,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTheme } from 'next-themes';
import { logoutAction } from '@/app/actions/auth';

interface AppSidebarProps {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
  };
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  const navItems = [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, action: null },
    { label: 'Subscriptions', href: '/subscriptions', icon: Repeat, action: 'manage:subscriptions' },
    { label: 'Customer Requests', href: '/requests', icon: Inbox, action: 'manage:requests' },
    { label: 'Invoices', href: '/invoices', icon: Receipt, action: 'manage:invoices' },
    { label: 'Payments', href: '/payments', icon: CreditCard, action: 'manage:payments' },
    { label: 'Billing Run', href: '/billing', icon: Layers, action: 'run:billing' },
    { label: 'Customers', href: '/customers', icon: Users, action: 'manage:customers' },
    { label: 'Products', href: '/products', icon: Package, action: 'manage:products' },
    { label: 'Plans', href: '/plans', icon: Layers, action: 'manage:plans' },
    { label: 'Templates', href: '/templates', icon: FileText, action: 'manage:templates' },
    { label: 'Discounts', href: '/discounts', icon: Percent, action: 'manage:discounts' },
    { label: 'Taxes', href: '/taxes', icon: Landmark, action: 'manage:taxes' },
    { label: 'Reports', href: '/reports', icon: BarChart3, action: 'view:reports' },
    { label: 'Audit Log', href: '/audit', icon: History, action: 'view:audit_logs' },
    { label: 'Email Outbox', href: '/outbox', icon: Mail, action: 'view:outbox' },
    { label: 'Staff Team', href: '/staff', icon: UserCheck, action: 'manage:staff' },
    { label: 'Settings', href: '/settings', icon: Settings, action: 'manage:settings' },
  ];

  const visibleItems = navItems.filter(
    (item) => !item.action || can(user.role, item.action as any)
  );

  return (
    <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between shrink-0">
      <div>
        {/* Brand Header */}
        <div className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">
              B
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Brightloop
            </span>
          </Link>
          <Badge
            variant="outline"
            className="text-xs uppercase tracking-wider font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700"
          >
            {user.role}
          </Badge>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-10rem)]">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* User Footer & Theme Toggle */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="truncate pr-2">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-200 truncate">{user.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-8 w-8 text-slate-500 dark:text-slate-400"
            title="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => logoutAction()}
          className="w-full justify-start text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 border-slate-200 dark:border-slate-800"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
