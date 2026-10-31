import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors';
import { RequestType } from '../constants';
import { todayBusinessDate } from '../dates/business-date';
import { createAuditLog } from './audit';
import { transitionSubscriptionTx, renewSubscriptionTx } from './subscriptions/transition';

export async function createSubscriptionRequest(
  customerId: string,
  subscriptionId: string,
  requestType: RequestType,
  customerNote?: string | null,
  todayOverride?: Date
) {
  const today = todayOverride || todayBusinessDate();

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Lock subscription row
      const locked = await tx.$queryRaw<
        {
          id: string;
          customerId: string;
          status: string;
          planId: string;
          expiryDate: Date | null;
        }[]
      >(Prisma.sql`
        SELECT "id", "customerId", "status", "planId", "expiryDate"
        FROM "Subscription"
        WHERE "id" = ${subscriptionId}
        FOR UPDATE
      `);

      if (!locked || locked.length === 0) {
        throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
      }
      const sub = locked[0];

      // Ownership check: must match customerId
      if (sub.customerId !== customerId) {
        throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
      }

      const plan = await tx.plan.findUnique({ where: { id: sub.planId } });
      if (!plan) {
        throw new AppError('NOT_FOUND', 'Plan not found.', 404);
      }

      const isExpired = sub.expiryDate && today.getTime() >= sub.expiryDate.getTime();

      // Validate according to requestType
      if (requestType === 'PAUSE') {
        if (sub.status !== 'ACTIVE') {
          throw new AppError('INVALID_TRANSITION', `Cannot request pause for subscription in ${sub.status} status.`, 409);
        }
        if (!plan.allowPause) {
          throw new AppError('PLAN_RULE_BLOCKED', 'Plan does not allow pause.', 422);
        }
        if (isExpired) {
          throw new AppError('PLAN_RULE_BLOCKED', 'Cannot pause an expired subscription.', 422);
        }
      } else if (requestType === 'RENEW') {
        if (sub.status !== 'ACTIVE' && sub.status !== 'PAUSED') {
          throw new AppError('INVALID_TRANSITION', `Cannot request renewal for subscription in ${sub.status} status.`, 409);
        }
        if (!plan.allowRenewal) {
          throw new AppError('PLAN_RULE_BLOCKED', 'Plan does not allow renewal.', 422);
        }
        if (!sub.expiryDate) {
          throw new AppError('VALIDATION_FAILED', 'Subscription has no expiry date to renew.', 422);
        }
      } else if (requestType === 'EARLY_CLOSE') {
        if (sub.status !== 'ACTIVE' && sub.status !== 'PAUSED') {
          throw new AppError('INVALID_TRANSITION', `Cannot request early close for subscription in ${sub.status} status.`, 409);
        }
        if (isExpired) {
          throw new AppError('PLAN_RULE_BLOCKED', 'Cannot request early closure after expiry.', 422);
        }
        if (!plan.allowEarlyClose) {
          throw new AppError('PLAN_RULE_BLOCKED', 'Plan does not allow early close.', 422);
        }
      } else {
        throw new AppError('VALIDATION_FAILED', 'Invalid request type.', 400);
      }

      // Insert request
      const req = await tx.subscriptionRequest.create({
        data: {
          subscriptionId: sub.id,
          customerId,
          requestType,
          status: 'PENDING',
          customerNote: customerNote || null,
        },
      });

      // Audit row: fromStatus null to PENDING
      await createAuditLog(
        {
          action: 'REQUEST_CREATED',
          entityType: 'SubscriptionRequest',
          entityId: req.id,
          fromStatus: null,
          toStatus: 'PENDING',
          metadata: { requestType, customerNote },
        },
        tx
      );

      return req;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('REQUEST_ALREADY_PENDING', 'A pending request of this type already exists for this subscription.', 409);
    }
    throw error;
  }
}

export async function reviewSubscriptionRequest(
  reviewerId: string,
  requestId: string,
  decision: 'APPROVE' | 'REJECT',
  reviewNote?: string | null,
  todayOverride?: Date
) {
  const today = todayOverride || todayBusinessDate();

  return prisma.$transaction(async (tx) => {
    // Lock order (section 5.7): SubscriptionRequest row first, then Subscription row
    const lockedReq = await tx.$queryRaw<
      {
        id: string;
        subscriptionId: string;
        requestType: string;
        status: string;
      }[]
    >(Prisma.sql`
      SELECT "id", "subscriptionId", "requestType", "status"
      FROM "SubscriptionRequest"
      WHERE "id" = ${requestId}
      FOR UPDATE
    `);

    if (!lockedReq || lockedReq.length === 0) {
      throw new AppError('NOT_FOUND', 'Subscription request not found.', 404);
    }
    const req = lockedReq[0];

    if (req.status !== 'PENDING') {
      throw new AppError('CONFLICT', `Request has already been reviewed (status: ${req.status}).`, 409);
    }

    if (decision === 'REJECT') {
      const updated = await tx.subscriptionRequest.update({
        where: { id: req.id },
        data: {
          status: 'REJECTED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewNote: reviewNote || null,
        },
      });

      await createAuditLog(
        {
          actorId: reviewerId,
          action: 'REQUEST_REJECTED',
          entityType: 'SubscriptionRequest',
          entityId: req.id,
          fromStatus: 'PENDING',
          toStatus: 'REJECTED',
          metadata: { reviewNote },
        },
        tx
      );

      return updated;
    }

    // Decision: APPROVE
    // Lock subscription row
    const lockedSub = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "Subscription"
      WHERE "id" = ${req.subscriptionId}
      FOR UPDATE
    `);
    if (!lockedSub || lockedSub.length === 0) {
      throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
    }

    // Execute matching transition or renewal
    if (req.requestType === 'PAUSE') {
      await transitionSubscriptionTx(tx, {
        subscriptionId: req.subscriptionId,
        action: 'PAUSE',
        actorId: reviewerId,
        todayOverride: today,
      });
    } else if (req.requestType === 'EARLY_CLOSE') {
      await transitionSubscriptionTx(tx, {
        subscriptionId: req.subscriptionId,
        action: 'EARLY_CLOSE',
        actorId: reviewerId,
        closeReason: reviewNote || 'Approved customer early close request',
        todayOverride: today,
      });
    } else if (req.requestType === 'RENEW') {
      await renewSubscriptionTx(tx, req.subscriptionId, reviewerId, today);
    }

    const updated = await tx.subscriptionRequest.update({
      where: { id: req.id },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: reviewNote || null,
      },
    });

    await createAuditLog(
      {
        actorId: reviewerId,
        action: 'REQUEST_APPROVED',
        entityType: 'SubscriptionRequest',
        entityId: req.id,
        fromStatus: 'PENDING',
        toStatus: 'APPROVED',
        metadata: { reviewNote },
      },
      tx
    );

    return updated;
  });
}
