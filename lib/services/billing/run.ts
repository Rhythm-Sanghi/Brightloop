import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { BILLING_MAX_PERIODS_PER_SUBSCRIPTION } from '../../config';
import { todayBusinessDate } from '../../dates/business-date';
import { claimNext } from './claim';
import { processSubscription } from './subscription';
import { eligibleDueSqlCondition } from './eligibility';
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
    maxPeriods?: number;
    hooks?: BillingRunHooks;
    testOptions?: BillingTestOptions;
    excludeSubscriptionIds?: string[];
  }
) {
  const runDate = options?.runDate || todayBusinessDate();
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
    },
  });

  await createAuditLog({
    billingRunId: billingRun.id,
    action: 'BILLING_RUN_START',
    entityType: 'BillingRun',
    entityId: billingRun.id,
    fromStatus: null,
    toStatus: 'RUNNING',
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
      await processSubscription(claimed, billingRun.id, runDate, maxPeriods, testOptions);
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
    // Count pending eligible due subscriptions now (no exclusions)
    const condition = eligibleDueSqlCondition(runDate);
    const pendingRows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "Subscription" s
      JOIN "Plan" p ON p."id" = s."planId"
      WHERE ${condition}
    `);
    const pending = Number(pendingRows[0]?.count || 0);

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

    const updatedRun = await prisma.billingRun.update({
      where: { id: billingRun.id },
      data: {
        status: finalStatus,
        invoicesGenerated,
        subscriptionsFullyProcessed,
        subscriptionsPartiallyProcessed,
        subscriptionsSkipped,
        subscriptionsFailed,
        subscriptionsPending: pending,
        finishedAt: new Date(),
      },
    });

    await createAuditLog({
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
      },
    });

    return updatedRun;
  } catch (error) {
    console.error('Billing run failed:', error);
    try {
      await prisma.billingRun.update({
        where: { id: billingRun.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
        },
      });

      await createAuditLog({
        billingRunId: billingRun.id,
        action: 'BILLING_RUN_FAILED',
        entityType: 'BillingRun',
        entityId: billingRun.id,
        fromStatus: 'RUNNING',
        toStatus: 'FAILED',
      });
    } catch {
      // Ignore if DB cannot write
    }
    throw error;
  }
}
