import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { BILLING_MAX_PERIODS_PER_SUBSCRIPTION } from '../../config';
import { todayBusinessDate } from '../../dates/business-date';
import { claimNext } from './claim';
import { processSubscription } from './subscription';
import { eligibleDueSqlCondition } from './eligibility';
import { countRemainingDuePeriods } from './remaining';
import { createAuditLog } from '../audit';
import { BillingRunStatus } from '../../constants';
import { BillingTestOptions } from './period';

export interface BillingRunHooks {
  onMainPassComplete?: () => Promise<void> | void;
  onRescanPass?: (passNumber: number) => Promise<void> | void;
}

export async function runBilling(
  startedById: string,
  options?: {
    runDate?: Date;
    asOfDate?: Date;
    auditAt?: Date;
    maxPeriods?: number;
    hooks?: BillingRunHooks;
    testOptions?: BillingTestOptions;
    excludeSubscriptionIds?: string[];
  }
) {
  const runDate = options?.asOfDate || options?.runDate || todayBusinessDate();
  const auditAt = options?.auditAt || options?.asOfDate;
  const maxPeriods = options?.maxPeriods ?? BILLING_MAX_PERIODS_PER_SUBSCRIPTION;
  const hooks = options?.hooks;
  const testOptions = options?.testOptions;

  // Step 1: Start
  const billingRun = await prisma.billingRun.create({
    data: {
      runDate,
      status: 'RUNNING',
      maxPeriodsPerSubscription: maxPeriods,
      startedById,
      ...(auditAt ? { startedAt: auditAt } : {}),
    },
  });

  await createAuditLog({
    billingRunId: billingRun.id,
    action: 'BILLING_RUN_START',
    entityType: 'BillingRun',
    entityId: billingRun.id,
    fromStatus: null,
    toStatus: 'RUNNING',
    auditAt,
  });

  const handled = new Set<string>();
  if (options?.excludeSubscriptionIds) {
    for (const id of options.excludeSubscriptionIds) {
      handled.add(id);
    }
  }

  const runPass = async (excluded: string[]) => {
    let cursor = '';
    while (true) {
      const claimed = await claimNext(runDate, cursor, excluded);
      if (!claimed) break;
      handled.add(claimed);
      await processSubscription(claimed, billingRun.id, runDate, maxPeriods, testOptions, auditAt);
      cursor = claimed;
    }
  };

  try {
    // Step 2: Main pass
    await runPass(Array.from(handled));

    if (hooks?.onMainPassComplete) {
      await hooks.onMainPassComplete();
    }

    // Step 3: Rescan passes (up to 3 times)
    for (let pass = 1; pass <= 3; pass++) {
      const excludedArray = Array.from(handled);
      const excludedSql =
        excludedArray.length > 0
          ? Prisma.sql`AND s."id" NOT IN (${Prisma.join(excludedArray)})`
          : Prisma.empty;

      const condition = eligibleDueSqlCondition(runDate);
      const unhandled = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT s."id"
        FROM "Subscription" s
        JOIN "Plan" p ON p."id" = s."planId"
        WHERE ${condition}
          ${excludedSql}
        LIMIT 1
      `);

      if (unhandled.length === 0) {
        break;
      }

      // Wait 500ms so that locks can be released
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (hooks?.onRescanPass) {
        await hooks.onRescanPass(pass);
      }

      await runPass(Array.from(handled));
    }

    // Step 4: Finalize
    // Compute the complete eligible set at runDate: ACTIVE subscriptions where
    // nextBillingDate <= runDate OR (expiryDate IS NOT NULL AND expiryDate <= runDate)
    const eligibleSubs = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { nextBillingDate: { lte: runDate } },
          { expiryDate: { not: null, lte: runDate } },
        ],
      },
      include: { plan: true },
    });

    let subscriptionsAwaitingInvoiceGeneration = 0;
    let subscriptionsAwaitingExpiryClosure = 0;
    let subscriptionsAwaitingManualExpiryClosure = 0;

    for (const sub of eligibleSubs) {
      const remResult = countRemainingDuePeriods(
        sub.startDate,
        sub.plan.billingPeriod,
        sub.plan.billingInterval,
        sub.billingCycleIndex,
        runDate,
        sub.expiryDate
      );
      if (remResult.remainingDuePeriods > 0) {
        subscriptionsAwaitingInvoiceGeneration++;
      } else if (sub.expiryDate && sub.expiryDate <= runDate) {
        if (sub.plan.autoCloseOnExpiry) {
          subscriptionsAwaitingExpiryClosure++;
        } else {
          subscriptionsAwaitingManualExpiryClosure++;
        }
      }
    }

    const pending = subscriptionsAwaitingInvoiceGeneration + subscriptionsAwaitingExpiryClosure;

    // Derive counters from this run's BILLING_OUTCOME audit rows
    const outcomeRows = await prisma.auditLog.findMany({
      where: {
        billingRunId: billingRun.id,
        action: 'BILLING_OUTCOME',
      },
      select: {
        metadata: true,
      },
    });

    let invoicesGenerated = 0;
    let subscriptionsFullyProcessed = 0;
    let subscriptionsPartiallyProcessed = 0;
    let subscriptionsSkipped = 0;
    let subscriptionsFailed = 0;

    for (const row of outcomeRows) {
      const meta = row.metadata as {
        finalOutcome?: string;
        invoicesGenerated?: number;
      } | null;

      if (!meta) continue;

      invoicesGenerated += meta.invoicesGenerated || 0;
      switch (meta.finalOutcome) {
        case 'FULLY_PROCESSED':
          subscriptionsFullyProcessed++;
          break;
        case 'PARTIALLY_PROCESSED':
          subscriptionsPartiallyProcessed++;
          break;
        case 'SKIPPED':
          subscriptionsSkipped++;
          break;
        case 'FAILED':
          subscriptionsFailed++;
          break;
      }
    }

    const finalStatus: BillingRunStatus =
      pending === 0 ? 'COMPLETED' : 'COMPLETED_WITH_PENDING';

    const updatedRun = await prisma.$transaction(async (tx) => {
      const run = await tx.billingRun.update({
        where: { id: billingRun.id },
        data: {
          status: finalStatus,
          invoicesGenerated,
          subscriptionsFullyProcessed,
          subscriptionsPartiallyProcessed,
          subscriptionsSkipped,
          subscriptionsFailed,
          subscriptionsPending: pending,
          finishedAt: auditAt || new Date(),
        },
      });

      await createAuditLog(
        {
          billingRunId: billingRun.id,
          action: 'BILLING_RUN_SUMMARY',
          entityType: 'BillingRun',
          entityId: billingRun.id,
          fromStatus: 'RUNNING',
          toStatus: finalStatus,
          metadata: {
            finalStatus,
            invoicesGenerated,
            subscriptionsFullyProcessed,
            subscriptionsPartiallyProcessed,
            subscriptionsSkipped,
            subscriptionsFailed,
            subscriptionsPending: pending,
            subscriptionsAwaitingInvoiceGeneration,
            subscriptionsAwaitingExpiryClosure,
            subscriptionsAwaitingManualExpiryClosure,
          },
          auditAt,
        },
        tx
      );

      return run;
    });

    return updatedRun;
  } catch (error) {
    console.error('Billing run failed:', error);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.billingRun.update({
          where: { id: billingRun.id },
          data: {
            status: 'FAILED',
            finishedAt: auditAt || new Date(),
          },
        });

        await createAuditLog(
          {
            billingRunId: billingRun.id,
            action: 'BILLING_RUN_FAILED',
            entityType: 'BillingRun',
            entityId: billingRun.id,
            fromStatus: 'RUNNING',
            toStatus: 'FAILED',
            metadata: {
              error: error instanceof Error ? error.message : String(error),
            },
            auditAt,
          },
          tx
        );
      });
    } catch {
      // Ignore if DB cannot write
    }
    throw error;
  }
}
