import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/guard';
import { todayBusinessDate, addDays, formatBusinessDate } from '@/lib/dates/business-date';
import { calculateMRRandARR, SubscriptionForMRR } from '@/lib/calculations/mrr';
import { isInvoiceOverdue } from '@/lib/calculations/overdue';
import { calculateHistoricalChurn } from '@/lib/calculations/churn';
import { toDecimal, round2, moneyString } from '@/lib/money';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Users,
  Repeat,
  CreditCard,
  Receipt,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  Activity,
  Layers,
  Calendar,
} from 'lucide-react';
import Decimal from 'decimal.js';

export default async function DashboardPage() {
  await requireUser();

  const today = todayBusinessDate();
  const thirtyDaysAgo = addDays(today, -30);
  const thirtyDaysAhead = addDays(today, 30);

  // 1. Active subscriptions (as of today): ACTIVE and not expired awaiting closure
  const activeSubs = await prisma.subscription.findMany({
    where: { status: 'ACTIVE' },
    include: {
      plan: true,
      lines: true,
      discounts: { include: { discount: true } },
    },
  });

  const validActiveSubs = activeSubs.filter((s) => {
    if (s.expiryDate && s.nextBillingDate) {
      if (s.nextBillingDate.getTime() > s.expiryDate.getTime()) {
        return false;
      }
    }
    return true;
  });

  const activeSubCount = validActiveSubs.length;

  // 2. MRR & ARR
  const mrrCandidates: SubscriptionForMRR[] = validActiveSubs.map((s) => {
    const gross = s.lines.reduce(
      (sum, l) => sum.plus(toDecimal(l.unitPrice).times(l.quantity)),
      toDecimal(0)
    );
    // Recurring value net of discounts
    let recurring = gross;
    for (const sd of s.discounts) {
      if (sd.discount.isActive && (!sd.discount.endsOn || sd.discount.endsOn.getTime() >= today.getTime())) {
        if (sd.discount.kind === 'FIXED') {
          recurring = Decimal.max(0, recurring.minus(toDecimal(sd.discount.value)));
        } else if (sd.discount.kind === 'PERCENT') {
          const discAmt = round2(gross.times(toDecimal(sd.discount.value)).dividedBy(100));
          recurring = Decimal.max(0, recurring.minus(discAmt));
        }
      }
    }

    return {
      id: s.id,
      status: s.status,
      billingPeriod: s.plan.billingPeriod,
      billingInterval: s.plan.billingInterval,
      startDate: s.startDate,
      expiryDate: s.expiryDate,
      nextBillingDate: s.nextBillingDate,
      recurringValue: recurring,
    };
  });

  const { mrrDisplayed, arr } = calculateMRRandARR(mrrCandidates);

  // 3. Collected cash (in range: last 30 days)
  const paymentsInRange = await prisma.payment.findMany({
    where: {
      paidOn: {
        gte: thirtyDaysAgo,
        lte: today,
      },
    },
    select: { amount: true },
  });
  const collectedCash = paymentsInRange.reduce(
    (sum, p) => sum.plus(toDecimal(p.amount)),
    toDecimal(0)
  );

  // 4. Invoiced revenue (in range: last 30 days, CONFIRMED and PAID only)
  const invoicesInRange = await prisma.invoice.findMany({
    where: {
      status: { in: ['CONFIRMED', 'PAID'] },
      issueDate: {
        gte: thirtyDaysAgo,
        lte: today,
      },
    },
    select: { total: true },
  });
  const invoicedRevenue = invoicesInRange.reduce(
    (sum, inv) => sum.plus(toDecimal(inv.total)),
    toDecimal(0)
  );

  // 5. Outstanding balance (as of today, CONFIRMED invoices)
  const confirmedInvoices = await prisma.invoice.findMany({
    where: { status: 'CONFIRMED' },
    select: { total: true, amountPaid: true, dueDate: true, id: true, number: true },
  });

  let outstandingBalance = toDecimal(0);
  let overdueCount = 0;
  let overdueAmount = toDecimal(0);

  for (const inv of confirmedInvoices) {
    const total = toDecimal(inv.total);
    const paid = toDecimal(inv.amountPaid);
    const balance = round2(total.minus(paid));
    if (balance.greaterThan(0)) {
      outstandingBalance = outstandingBalance.plus(balance);
      if (isInvoiceOverdue({ status: 'CONFIRMED', dueDate: inv.dueDate, total, amountPaid: paid }, today)) {
        overdueCount++;
        overdueAmount = overdueAmount.plus(balance);
      }
    }
  }

  // 6. Latest billing run status
  const latestRun = await prisma.billingRun.findFirst({
    orderBy: { startedAt: 'desc' },
  });

  // 7. Recent payments
  const recentPayments = await prisma.payment.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: {
      invoice: {
        include: { customer: true },
      },
    },
  });

  // 8. Upcoming renewals (next 30 days)
  const upcomingRenewals = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'PAUSED'] },
      expiryDate: {
        gte: today,
        lte: thirtyDaysAhead,
      },
    },
    take: 5,
    orderBy: { expiryDate: 'asc' },
    include: { customer: true, plan: true },
  });

  // 9. Recent activity
  const recentActivity = await prisma.auditLog.findMany({
    take: 6,
    orderBy: { seq: 'desc' },
    include: { actor: true },
  });

  return (
    <div className="space-y-8">
      {/* Top Banner / Billing Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Billing Engine Status
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Latest Run:{' '}
              {latestRun ? (
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {latestRun.status} ({latestRun.subscriptionsPending} pending subscriptions)
                </span>
              ) : (
                'No runs executed yet'
              )}
            </p>
          </div>
        </div>
        <Link href="/billing">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white font-medium">
            Open Billing Run Panel <ArrowUpRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Subscriptions */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Active Subscriptions
            </CardTitle>
            <Repeat className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {activeSubCount}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">as of today (snapshot)</p>
          </CardContent>
        </Card>

        {/* MRR */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Monthly Recurring (MRR)
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              ₹{moneyString(mrrDisplayed)}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              ARR: ₹{moneyString(arr)} (as of today)
            </p>
          </CardContent>
        </Card>

        {/* Invoiced Revenue */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Invoiced Revenue
            </CardTitle>
            <Receipt className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              ₹{moneyString(invoicedRevenue)}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">in range (last 30 days)</p>
          </CardContent>
        </Card>

        {/* Collected Cash */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Collected Cash
            </CardTitle>
            <CreditCard className="h-4 w-4 text-teal-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              ₹{moneyString(collectedCash)}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">in range (last 30 days)</p>
          </CardContent>
        </Card>

        {/* Outstanding Balance */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Outstanding Balance
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              ₹{moneyString(outstandingBalance)}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">as of today</p>
          </CardContent>
        </Card>

        {/* Overdue Invoices */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Overdue Invoices
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">
              {overdueCount} ({moneyString(overdueAmount)})
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">past due date as of today</p>
          </CardContent>
        </Card>
      </div>

      {/* Lists Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Payments */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent Payments
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Latest transactions recorded across methods
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentPayments.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No recent payments found.</p>
            ) : (
              <div className="space-y-3">
                {recentPayments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {p.invoice.customer.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.method} • {formatBusinessDate(p.paidOn)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        +₹{p.amount.toString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Renewals */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Upcoming Renewals
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Subscriptions expiring within the next 30 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {upcomingRenewals.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No renewals due in next 30 days.</p>
            ) : (
              <div className="space-y-3">
                {upcomingRenewals.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {s.customer.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {s.plan.name} • Exp: {s.expiryDate ? formatBusinessDate(s.expiryDate) : 'No expiry'}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {s.number || 'Pending'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity Audit Trail */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Recent System Activity
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Immutable audit trail from PostgreSQL (ordered by seq desc)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentActivity.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between text-xs p-2 rounded border border-slate-100 dark:border-slate-800/60"
              >
                <div className="flex items-center space-x-2">
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    #{log.seq.toString()}
                  </Badge>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{log.action}</span>
                  <span className="text-slate-500">on {log.entityType}</span>
                </div>
                <div className="text-slate-400">
                  {log.createdAt.toISOString().replace('T', ' ').substring(0, 19)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
