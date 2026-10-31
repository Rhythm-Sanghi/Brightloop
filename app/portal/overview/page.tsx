import { requireUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { todayBusinessDate, formatBusinessDate } from '@/lib/dates/business-date';
import { toDecimal, round2, moneyString } from '@/lib/money';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Repeat, Receipt, CreditCard, Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default async function CustomerOverviewPage() {
  const user = await requireUser();
  const customerId = user.customerId;

  if (!customerId) {
    return (
      <div className="p-8 text-center text-slate-500">
        No customer profile linked to this user.
      </div>
    );
  }

  const today = todayBusinessDate();

  // Load customer subscriptions
  const subscriptions = await prisma.subscription.findMany({
    where: { customerId },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });

  const activeSubs = subscriptions.filter((s) => s.status === 'ACTIVE');
  const activeSubCount = activeSubs.length;

  // Next billing date: earliest nextBillingDate among active subscriptions
  let earliestNextBilling: Date | null = null;
  for (const sub of activeSubs) {
    if (sub.nextBillingDate) {
      if (!earliestNextBilling || sub.nextBillingDate.getTime() < earliestNextBilling.getTime()) {
        earliestNextBilling = sub.nextBillingDate;
      }
    }
  }

  // Load customer invoices
  const invoices = await prisma.invoice.findMany({
    where: { customerId },
    orderBy: { issueDate: 'desc' },
    take: 5,
  });

  // Outstanding balance: sum of total - amountPaid on CONFIRMED invoices
  const confirmedInvoices = await prisma.invoice.findMany({
    where: { customerId, status: 'CONFIRMED' },
    select: { total: true, amountPaid: true },
  });

  const outstandingBalance = confirmedInvoices.reduce((sum, inv) => {
    const bal = round2(toDecimal(inv.total).minus(toDecimal(inv.amountPaid)));
    return sum.plus(bal);
  }, toDecimal(0));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Welcome back, {user.name}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Manage your active subscriptions, review upcoming billings, and inspect past invoices.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Active Subscriptions
            </CardTitle>
            <Repeat className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              {activeSubCount}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Currently active services</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Next Billing Date
            </CardTitle>
            <Calendar className="h-4 w-4 text-teal-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {earliestNextBilling ? formatBusinessDate(earliestNextBilling) : 'None scheduled'}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Earliest upcoming cycle</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Outstanding Balance
            </CardTitle>
            <Receipt className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              ₹{moneyString(outstandingBalance)}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Pending payments</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Invoices */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Recent Invoices
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Your latest billing statements
              </CardDescription>
            </div>
            <Link href="/portal/invoices">
              <Button variant="ghost" size="sm" className="text-blue-600 text-xs">
                View All <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No invoices yet.</p>
            ) : (
              <div className="space-y-3">
                {invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {inv.number || 'Draft Invoice'}
                      </p>
                      <p className="text-xs text-slate-500">
                        Issued: {formatBusinessDate(inv.issueDate)} • Due: {formatBusinessDate(inv.dueDate)}
                      </p>
                    </div>
                    <div className="text-right flex items-center space-x-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          ₹{inv.total.toString()}
                        </p>
                        <Badge
                          variant={inv.status === 'PAID' ? 'default' : inv.status === 'CONFIRMED' ? 'outline' : 'secondary'}
                          className="text-[10px]"
                        >
                          {inv.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* My Subscriptions List */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                My Subscriptions
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Active & recurring plans
              </CardDescription>
            </div>
            <Link href="/portal/subscriptions">
              <Button variant="ghost" size="sm" className="text-blue-600 text-xs">
                Manage <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {subscriptions.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No subscriptions found.</p>
            ) : (
              <div className="space-y-3">
                {subscriptions.slice(0, 5).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {s.plan.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {s.number || 'Quotation'} • Started {formatBusinessDate(s.startDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={s.status === 'ACTIVE' ? 'default' : 'outline'}
                        className={`text-xs ${s.status === 'ACTIVE' ? 'bg-emerald-600 text-white' : ''}`}
                      >
                        {s.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
