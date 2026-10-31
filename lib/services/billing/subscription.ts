import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runPeriod, BillingTestOptions } from './period';
import { countRemainingDuePeriods } from './remaining';
import { createAuditLog } from '../audit';
import { BillingOutcome } from '../../constants';

export interface ProcessSubscriptionResult {
  finalOutcome: BillingOutcome;
  invoicesGenerated: number;
  attemptsUsed: number;
  remainingDuePeriods: number;
  reason?: string | null;
}

export async function processSubscription(
  subscriptionId: string,
  billingRunId: string,
  runDate: Date,
  maxPeriods: number,
  testOptions?: BillingTestOptions
): Promise<ProcessSubscriptionResult> {
  let invoicesGenerated = 0;
  let attemptsUsed = 0;
  let finalOutcome: BillingOutcome = 'FULLY_PROCESSED';
  let reason: string | null = null;
  let errorCode: string | null = null;
  let closedByExpiry = false;
  let stoppedEarly = false;

  while (attemptsUsed < maxPeriods) {
    attemptsUsed++;
    const res = await runPeriod(subscriptionId, billingRunId, runDate, testOptions);

    if (res.type === 'INVOICE_CREATED') {
      invoicesGenerated++;
      continue;
    }

    if (res.type === 'REPAIRED') {
      continue;
    }

    if (res.type === 'NOT_DUE') {
      stoppedEarly = true;
      reason = res.reason || 'ALREADY_CURRENT';
      break;
    }

    if (res.type === 'EXPIRED_CLOSED') {
      stoppedEarly = true;
      closedByExpiry = true;
      reason = 'AUTO_CLOSED_EXPIRED';
      break;
    }

    if (res.type === 'EXPIRED_AWAITING') {
      stoppedEarly = true;
      reason = 'EXPIRED_AWAITING_CLOSURE';
      break;
    }

    if (res.type === 'FAILED') {
      stoppedEarly = true;
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

  // Outcome classification (pure table):
  // cap reached with remaining due periods gives PARTIALLY_PROCESSED;
  // cap reached with none remaining gives FULLY_PROCESSED;
  // a failure gives FAILED;
  // no invoice and no pending work gives SKIPPED;
  // at least one invoice and no pending work gives FULLY_PROCESSED.
  if (finalOutcome !== 'FAILED') {
    if (attemptsUsed >= maxPeriods && remaining > 0) {
      finalOutcome = 'PARTIALLY_PROCESSED';
    } else if (invoicesGenerated === 0) {
      finalOutcome = 'SKIPPED';
    } else {
      finalOutcome = 'FULLY_PROCESSED';
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
          attemptsUsed,
          remainingDuePeriods: remaining,
          overflow,
          closedByExpiry,
          errorCode,
        },
      },
      tx
    );
  });

  return {
    finalOutcome,
    invoicesGenerated,
    attemptsUsed,
    remainingDuePeriods: remaining,
    reason,
  };
}
