import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../errors';
import { TransitionAction } from '../../constants';
import {
  todayBusinessDate,
  addDays,
  findResumeIndex,
  calculateRenewalExpiry,
} from '../../dates/business-date';
import { reserveSubscriptionNumber } from '../numbering';
import { createAuditLog } from '../audit';

export interface TransitionSubscriptionInput {
  subscriptionId: string;
  action: TransitionAction;
  actorId?: string | null;
  billingRunId?: string | null;
  closeReason?: string | null;
  todayOverride?: Date; // For testing or simulated runs
}

export async function transitionSubscription(
  input: TransitionSubscriptionInput
): Promise<{ status: string; number?: string | null }> {
  return prisma.$transaction(async (tx) => {
    return transitionSubscriptionTx(tx, input);
  });
}

export async function transitionSubscriptionTx(
  tx: Prisma.TransactionClient,
  input: TransitionSubscriptionInput
): Promise<{ status: string; number?: string | null }> {
  const today = input.todayOverride || todayBusinessDate();

  // 1. Lock the subscription row
  const lockedRows = await tx.$queryRaw<
    {
      id: string;
      number: string | null;
      status: string;
      planId: string;
      templateId: string | null;
      startDate: Date;
      expiryDate: Date | null;
      nextBillingDate: Date | null;
      billingCycleIndex: number;
      quotationValidUntil: Date | null;
      pausedAt: Date | null;
      closedAt: Date | null;
      closeReason: string | null;
    }[]
  >(Prisma.sql`
    SELECT *
    FROM "Subscription"
    WHERE "id" = ${input.subscriptionId}
    FOR UPDATE
  `);

  if (!lockedRows || lockedRows.length === 0) {
    throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
  }

  const sub = lockedRows[0];
  const fromStatus = sub.status;

  // Load plan and lines
  const plan = await tx.plan.findUnique({
    where: { id: sub.planId },
  });
  if (!plan) {
    throw new AppError('NOT_FOUND', 'Plan not found.', 404);
  }

  const lines = await tx.subscriptionLine.findMany({
    where: { subscriptionId: sub.id },
  });

  let toStatus = fromStatus;
  let newNumber = sub.number;
  let updateData: Prisma.SubscriptionUpdateInput = {};

  switch (input.action) {
    case 'SEND_QUOTATION': {
      if (fromStatus !== 'DRAFT') {
        throw new AppError('INVALID_TRANSITION', `Cannot SEND_QUOTATION from ${fromStatus}`, 409);
      }
      toStatus = 'QUOTATION';
      let validityDays = 30;
      if (sub.templateId) {
        const template = await tx.quotationTemplate.findUnique({
          where: { id: sub.templateId },
        });
        if (template?.validityDays) {
          validityDays = template.validityDays;
        }
      }
      const quotationValidUntil = addDays(today, validityDays);
      updateData = {
        status: toStatus,
        quotationValidUntil,
      };
      break;
    }

    case 'DISCARD': {
      if (fromStatus !== 'DRAFT') {
        throw new AppError('INVALID_TRANSITION', `Cannot DISCARD from ${fromStatus}`, 409);
      }
      if (!input.closeReason) {
        throw new AppError('VALIDATION_FAILED', 'Discarding a draft requires a close reason.', 422);
      }
      toStatus = 'CLOSED';
      updateData = {
        status: toStatus,
        closedAt: new Date(),
        closeReason: input.closeReason,
      };
      break;
    }

    case 'CANCEL_QUOTATION': {
      if (fromStatus !== 'QUOTATION') {
        throw new AppError('INVALID_TRANSITION', `Cannot CANCEL_QUOTATION from ${fromStatus}`, 409);
      }
      toStatus = 'CLOSED';
      updateData = {
        status: toStatus,
        closedAt: new Date(),
        closeReason: input.closeReason || 'Quotation cancelled',
      };
      break;
    }

    case 'CONFIRM_QUOTATION': {
      if (fromStatus !== 'QUOTATION') {
        throw new AppError('INVALID_TRANSITION', `Cannot CONFIRM_QUOTATION from ${fromStatus}`, 409);
      }
      // Check 1: quotationValidUntil is on or after today
      if (!sub.quotationValidUntil || sub.quotationValidUntil.getTime() < today.getTime()) {
        throw new AppError('QUOTATION_EXPIRED', 'The quotation has expired.', 422);
      }
      // Check 2: Plan is active
      if (!plan.isActive) {
        throw new AppError('PLAN_UNAVAILABLE', 'Plan is currently inactive.', 422);
      }
      // Check 3: Today is within plan.availableFrom and plan.availableUntil
      const todayTime = today.getTime();
      const fromTime = plan.availableFrom.getTime();
      if (todayTime < fromTime) {
        throw new AppError('PLAN_UNAVAILABLE', 'Plan is not yet available.', 422);
      }
      if (plan.availableUntil && todayTime > plan.availableUntil.getTime()) {
        throw new AppError('PLAN_UNAVAILABLE', 'Plan availability has ended.', 422);
      }
      // Check 4: Total line quantity >= plan.minimumQuantity
      const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
      if (totalQuantity < plan.minimumQuantity) {
        throw new AppError('MIN_QUANTITY_NOT_MET', `Plan requires minimum quantity of ${plan.minimumQuantity}`, 422);
      }
      // Check 5: expiryDate is set and is on or after startDate
      if (!sub.expiryDate || sub.expiryDate.getTime() < sub.startDate.getTime()) {
        throw new AppError('VALIDATION_FAILED', 'Expiry date must be set and on or after start date.', 422);
      }

      // Assign subscription number
      newNumber = await reserveSubscriptionNumber(tx);
      toStatus = 'CONFIRMED';
      updateData = {
        status: toStatus,
        number: newNumber,
      };
      break;
    }

    case 'ACTIVATE': {
      if (fromStatus !== 'CONFIRMED') {
        throw new AppError('INVALID_TRANSITION', `Cannot ACTIVATE from ${fromStatus}`, 409);
      }
      toStatus = 'ACTIVE';
      updateData = {
        status: toStatus,
        nextBillingDate: sub.startDate,
        billingCycleIndex: 0,
      };
      break;
    }

    case 'CANCEL': {
      if (fromStatus !== 'CONFIRMED') {
        throw new AppError('INVALID_TRANSITION', `Cannot CANCEL from ${fromStatus}`, 409);
      }
      toStatus = 'CLOSED';
      updateData = {
        status: toStatus,
        closedAt: new Date(),
        closeReason: input.closeReason || 'Cancelled before activation',
      };
      break;
    }

    case 'PAUSE': {
      if (fromStatus !== 'ACTIVE') {
        throw new AppError('INVALID_TRANSITION', `Cannot PAUSE from ${fromStatus}`, 409);
      }
      if (!plan.allowPause) {
        throw new AppError('PLAN_RULE_BLOCKED', 'Plan does not allow pausing.', 422);
      }
      if (sub.expiryDate && today.getTime() >= sub.expiryDate.getTime()) {
        throw new AppError('PLAN_RULE_BLOCKED', 'Cannot pause an expired subscription.', 422);
      }
      toStatus = 'PAUSED';
      updateData = {
        status: toStatus,
        pausedAt: new Date(),
      };
      break;
    }

    case 'RESUME': {
      if (fromStatus !== 'PAUSED') {
        throw new AppError('INVALID_TRANSITION', `Cannot RESUME from ${fromStatus}`, 409);
      }
      if (sub.expiryDate && today.getTime() >= sub.expiryDate.getTime()) {
        throw new AppError('PLAN_RULE_BLOCKED', 'Cannot resume an expired subscription.', 422);
      }
      const resumed = findResumeIndex(
        sub.startDate,
        plan.billingPeriod,
        plan.billingInterval,
        sub.billingCycleIndex,
        today
      );
      toStatus = 'ACTIVE';
      updateData = {
        status: toStatus,
        billingCycleIndex: resumed.resumeIndex,
        nextBillingDate: resumed.nextBillingDate,
        pausedAt: null,
      };
      break;
    }

    case 'EARLY_CLOSE': {
      if (fromStatus !== 'ACTIVE' && fromStatus !== 'PAUSED') {
        throw new AppError('INVALID_TRANSITION', `Cannot EARLY_CLOSE from ${fromStatus}`, 409);
      }
      const isBeforeExpiry = !sub.expiryDate || today.getTime() < sub.expiryDate.getTime();
      if (!isBeforeExpiry) {
        throw new AppError('PLAN_RULE_BLOCKED', 'Subscription has reached or passed expiry; use EXPIRY_CLOSE.', 422);
      }
      if (!plan.allowEarlyClose) {
        throw new AppError('PLAN_RULE_BLOCKED', 'Plan does not allow early closure.', 422);
      }
      toStatus = 'CLOSED';
      updateData = {
        status: toStatus,
        closedAt: new Date(),
        closeReason: input.closeReason || 'Early closure',
      };
      break;
    }

    case 'EXPIRY_CLOSE': {
      if (fromStatus !== 'ACTIVE' && fromStatus !== 'PAUSED') {
        throw new AppError('INVALID_TRANSITION', `Cannot EXPIRY_CLOSE from ${fromStatus}`, 409);
      }
      if (!sub.expiryDate || today.getTime() < sub.expiryDate.getTime()) {
        throw new AppError('PLAN_RULE_BLOCKED', 'Subscription has not yet expired.', 422);
      }
      // System expiry closure check
      if (!input.actorId && input.billingRunId) {
        if (!plan.autoCloseOnExpiry) {
          throw new AppError('PLAN_RULE_BLOCKED', 'Plan does not auto-close on expiry.', 422);
        }
      }
      // Staff/admin can close on expiry regardless of allowEarlyClose!
      toStatus = 'CLOSED';
      updateData = {
        status: toStatus,
        closedAt: new Date(),
        closeReason: input.closeReason || 'EXPIRED',
      };
      break;
    }

    default:
      throw new AppError('INVALID_TRANSITION', `Unknown action ${input.action}`, 409);
  }

  // Update subscription
  await tx.subscription.update({
    where: { id: sub.id },
    data: updateData,
  });

  // Write audit row
  await createAuditLog(
    {
      actorId: input.actorId ?? null,
      billingRunId: input.billingRunId ?? null,
      action: input.action,
      entityType: 'Subscription',
      entityId: sub.id,
      fromStatus,
      toStatus,
      metadata: {
        closeReason: input.closeReason ?? null,
      },
    },
    tx
  );

  return { status: toStatus, number: newNumber };
}

export async function renewSubscriptionTx(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  actorId?: string | null,
  todayOverride?: Date
): Promise<{ newExpiry: Date; renewalCount: number }> {
  const today = todayOverride || todayBusinessDate();

  const lockedRows = await tx.$queryRaw<
    {
      id: string;
      status: string;
      planId: string;
      expiryDate: Date | null;
      renewalCount: number;
    }[]
  >(Prisma.sql`
    SELECT "id", "status", "planId", "expiryDate", "renewalCount"
    FROM "Subscription"
    WHERE "id" = ${subscriptionId}
    FOR UPDATE
  `);

  if (!lockedRows || lockedRows.length === 0) {
    throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
  }
  const sub = lockedRows[0];

  if (sub.status !== 'ACTIVE' && sub.status !== 'PAUSED') {
    throw new AppError('INVALID_TRANSITION', `Cannot renew subscription in ${sub.status} status.`, 409);
  }

  const plan = await tx.plan.findUnique({ where: { id: sub.planId } });
  if (!plan) {
    throw new AppError('NOT_FOUND', 'Plan not found.', 404);
  }

  if (!plan.allowRenewal) {
    throw new AppError('PLAN_RULE_BLOCKED', 'Plan does not allow renewals.', 422);
  }

  if (!sub.expiryDate) {
    throw new AppError('VALIDATION_FAILED', 'Subscription has no expiry date.', 422);
  }

  const newExpiry = calculateRenewalExpiry(sub.expiryDate, plan.billingPeriod, plan.billingInterval, today);
  const newRenewalCount = sub.renewalCount + 1;

  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      expiryDate: newExpiry,
      renewalCount: newRenewalCount,
    },
  });

  await createAuditLog(
    {
      actorId: actorId ?? null,
      action: 'RENEWED',
      entityType: 'Subscription',
      entityId: sub.id,
      fromStatus: sub.status,
      toStatus: sub.status,
      metadata: {
        previousExpiry: sub.expiryDate.toISOString(),
        newExpiry: newExpiry.toISOString(),
        renewalCount: newRenewalCount,
      },
    },
    tx
  );

  return { newExpiry, renewalCount: newRenewalCount };
}
