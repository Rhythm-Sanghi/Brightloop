import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runPeriod, BillingTestOptions } from './period';
import { countRemainingDuePeriods } from './remaining';
import { createAuditLog } from '../audit';
import { BillingOutcome } from '../../constants';

export const MAX_REPAIRS_PER_SUBSCRIPTION_PER_RUN = 3;

export interface ProcessSubscriptionResult {
  finalOutcome: BillingOutcome;
  invoicesGenerated: number;
  repairsUsed: number;
  attemptsUsed: number;
  remainingDuePeriods: number;
  reason?: string | null;
}

export async function processSubscription(
  subscriptionId: string,
  billingRunId: string,
  runDate: Date,
  maxPeriods: number,
  testOptions?: BillingTestOptions,
  auditAt?: Date
): Promise<ProcessSubscriptionResult> {
  let invoicesGenerated = 0;
  let repairsUsed = 0;
  let finalOutcome: BillingOutcome = 'FULLY_PROCESSED';
  let reason: string | null = null;
  let errorCode: string | null = null;
  let closedByExpiry = false;

  while (invoicesGenerated < maxPeriods) {
    const allowRepair =
      testOptions?.allowRepair !== undefined
        ? testOptions.allowRepair && repairsUsed < MAX_REPAIRS_PER_SUBSCRIPTION_PER_RUN
        : repairsUsed < MAX_REPAIRS_PER_SUBSCRIPTION_PER_RUN;

    const res = await runPeriod(
      subscriptionId,
      billingRunId,
      runDate,
      {
        ...testOptions,
        allowRepair,
      },
      auditAt
    );

    if (res.type === 'INVOICE_CREATED') {
      invoicesGenerated++;
      if (invoicesGenerated === maxPeriods) {
        break;
      }
      continue;
    }

    if (res.type === 'REPAIRED') {
      repairsUsed++;
      continue;
    }

    if (res.type === 'NOT_DUE') {
      reason = res.reason || 'ALREADY_CURRENT';
      break;
    }

    if (res.type === 'EXPIRED_CLOSED') {
      closedByExpiry = true;
      reason = 'AUTO_CLOSED_EXPIRED';
      break;
    }

    if (res.type === 'EXPIRED_AWAITING') {
      reason = 'EXPIRED_AWAITING_CLOSURE';
      break;
    }

    if (res.type === 'FAILED') {
      errorCode = res.errorCode || 'FAILED';
      reason = res.reason || errorCode;
      finalOutcome = 'FAILED';
      break;
    }
  }

  // Calculate remaining due periods from current DB state
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });

  let remaining = 0;
  let overflow = false;
  if (sub && sub.status === 'ACTIVE') {
    const remResult = countRemainingDuePeriods(
      sub.startDate,
      sub.plan.billingPeriod,
      sub.plan.billingInterval,
      sub.billingCycleIndex,
      runDate,
      sub.expiryDate
    );
    remaining = remResult.remainingDuePeriods;
    overflow = remResult.overflow;
  }

  // Outcome precedence (spec §10.4):
  if (finalOutcome !== 'FAILED') {
    if (remaining > 0) {
      finalOutcome = 'PARTIALLY_PROCESSED';
    } else if (invoicesGenerated > 0) {
      finalOutcome = 'FULLY_PROCESSED';
    } else {
      finalOutcome = 'SKIPPED';
    }
  }

  // Record BILLING_OUTCOME in a short transaction that locks the subscription row
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Subscription" WHERE "id" = ${subscriptionId} FOR UPDATE
    `);

    await createAuditLog(
      {
        billingRunId,
        action: 'BILLING_OUTCOME',
        entityType: 'Subscription',
        entityId: subscriptionId,
        metadata: {
          finalOutcome,
          reason,
          invoicesGenerated,
          repairsUsed,
          attemptsUsed: invoicesGenerated + repairsUsed,
          remainingDuePeriods: remaining,
          overflow,
          closedByExpiry,
          errorCode,
        },
        auditAt,
      },
      tx
    );
  });

  return {
    finalOutcome,
    invoicesGenerated,
    repairsUsed,
    attemptsUsed: invoicesGenerated + repairsUsed,
    remainingDuePeriods: remaining,
    reason,
  };
}
