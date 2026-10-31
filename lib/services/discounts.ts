import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors';
import { DiscountKind, DiscountScope } from '../constants';
import { round2, toDecimal } from '../money';
import { createAuditLog } from './audit';
import { todayBusinessDate } from '../dates/business-date';

export interface CreateDiscountInput {
  name: string;
  kind: DiscountKind;
  value: string | number;
  scope: DiscountScope;
  minPurchaseAmount?: string | number | null;
  minQuantity?: number | null;
  startsOn: Date;
  endsOn?: Date | null;
  maxUses?: number | null;
  productIds?: string[];
  actorId?: string | null;
}

export async function createDiscount(input: CreateDiscountInput) {
  const decValue = round2(toDecimal(input.value));
  if (!decValue.greaterThan(0)) {
    throw new AppError('VALIDATION_FAILED', 'Discount value must be greater than zero.', 422);
  }

  if (input.kind === 'PERCENT' && decValue.greaterThan(100)) {
    throw new AppError('VALIDATION_FAILED', 'Percent discount value cannot exceed 100.', 422);
  }

  return prisma.$transaction(async (tx) => {
    const discount = await tx.discount.create({
      data: {
        name: input.name,
        kind: input.kind,
        value: decValue.toString(),
        scope: input.scope,
        minPurchaseAmount: input.minPurchaseAmount
          ? round2(toDecimal(input.minPurchaseAmount)).toString()
          : null,
        minQuantity: input.minQuantity ?? null,
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? null,
        maxUses: input.maxUses ?? null,
        ...(input.scope === 'PRODUCT' && input.productIds && input.productIds.length > 0
          ? {
              products: {
                create: input.productIds.map((pid) => ({ productId: pid })),
              },
            }
          : {}),
      },
    });

    await createAuditLog(
      {
        actorId: input.actorId ?? null,
        action: 'DISCOUNT_CREATED',
        entityType: 'Discount',
        entityId: discount.id,
        metadata: { name: discount.name, kind: discount.kind, scope: discount.scope },
      },
      tx
    );

    return discount;
  });
}

export interface UpdateDiscountInput {
  id: string;
  name?: string;
  kind?: DiscountKind;
  value?: string | number;
  scope?: DiscountScope;
  minPurchaseAmount?: string | number | null;
  minQuantity?: number | null;
  startsOn?: Date;
  endsOn?: Date | null;
  maxUses?: number | null;
  isActive?: boolean;
  productIds?: string[];
  actorId?: string | null;
}

export async function updateDiscount(input: UpdateDiscountInput) {
  return prisma.$transaction(async (tx) => {
    // Lock discount row (section 5.7)
    const lockedRows = await tx.$queryRaw<
      {
        id: string;
        scope: string;
      }[]
    >(Prisma.sql`
      SELECT "id", "scope"
      FROM "Discount"
      WHERE "id" = ${input.id}
      FOR UPDATE
    `);

    if (!lockedRows || lockedRows.length === 0) {
      throw new AppError('NOT_FOUND', 'Discount not found.', 404);
    }
    const current = lockedRows[0];

    // Protected scope changes:
    if (input.scope && input.scope !== current.scope) {
      if (current.scope === 'SUBSCRIPTION' && input.scope === 'PRODUCT') {
        const assignedCount = await tx.subscriptionDiscount.count({
          where: { discountId: current.id },
        });
        if (assignedCount > 0) {
          throw new AppError(
            'CONFLICT',
            'Cannot change scope from SUBSCRIPTION to PRODUCT while subscription assignments exist. Remove assignments first.',
            409
          );
        }
      } else if (current.scope === 'PRODUCT' && input.scope === 'SUBSCRIPTION') {
        const linkedCount = await tx.discountProduct.count({
          where: { discountId: current.id },
        });
        if (linkedCount > 0) {
          throw new AppError(
            'CONFLICT',
            'Cannot change scope from PRODUCT to SUBSCRIPTION while product links exist. Remove product links first.',
            409
          );
        }
      }
    }

    const updateData: Prisma.DiscountUpdateInput = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.kind !== undefined) updateData.kind = input.kind;
    if (input.scope !== undefined) updateData.scope = input.scope;
    if (input.value !== undefined) {
      const dec = round2(toDecimal(input.value));
      if (!dec.greaterThan(0)) {
        throw new AppError('VALIDATION_FAILED', 'Discount value must be greater than zero.', 422);
      }
      updateData.value = dec.toString();
    }
    if (input.minPurchaseAmount !== undefined) {
      updateData.minPurchaseAmount = input.minPurchaseAmount
        ? round2(toDecimal(input.minPurchaseAmount)).toString()
        : null;
    }
    if (input.minQuantity !== undefined) updateData.minQuantity = input.minQuantity;
    if (input.startsOn !== undefined) updateData.startsOn = input.startsOn;
    if (input.endsOn !== undefined) updateData.endsOn = input.endsOn;
    if (input.maxUses !== undefined) updateData.maxUses = input.maxUses;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    if (input.productIds !== undefined && (input.scope === 'PRODUCT' || current.scope === 'PRODUCT')) {
      await tx.discountProduct.deleteMany({ where: { discountId: current.id } });
      await tx.discountProduct.createMany({
        data: input.productIds.map((pid) => ({
          discountId: current.id,
          productId: pid,
        })),
      });
    }

    const updated = await tx.discount.update({
      where: { id: current.id },
      data: updateData,
    });

    await createAuditLog(
      {
        actorId: input.actorId ?? null,
        action: 'DISCOUNT_UPDATED',
        entityType: 'Discount',
        entityId: current.id,
        metadata: { changes: JSON.parse(JSON.stringify(input)) },
      },
      tx
    );

    return updated;
  });
}

export async function assignSubscriptionDiscount(
  subscriptionId: string,
  discountId: string,
  actorId?: string | null,
  todayOverride?: Date
) {
  const today = todayOverride || todayBusinessDate();

  return prisma.$transaction(async (tx) => {
    // Lock subscription row (section 5.7)
    const lockedSub = await tx.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`
      SELECT "id", "status"
      FROM "Subscription"
      WHERE "id" = ${subscriptionId}
      FOR UPDATE
    `);

    if (!lockedSub || lockedSub.length === 0) {
      throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
    }
    if (lockedSub[0].status === 'CLOSED') {
      throw new AppError('VALIDATION_FAILED', 'Cannot assign discount to closed subscription.', 422);
    }

    // Validate discount
    const discount = await tx.discount.findUnique({ where: { id: discountId } });
    if (!discount || !discount.isActive || discount.scope !== 'SUBSCRIPTION') {
      throw new AppError('VALIDATION_FAILED', 'Discount must be active and have SUBSCRIPTION scope.', 422);
    }

    if (discount.endsOn && discount.endsOn.getTime() < today.getTime()) {
      throw new AppError('VALIDATION_FAILED', 'Discount has already expired.', 422);
    }

    try {
      const assignment = await tx.subscriptionDiscount.create({
        data: {
          subscriptionId,
          discountId,
        },
      });

      await createAuditLog(
        {
          actorId: actorId ?? null,
          action: 'SUBSCRIPTION_DISCOUNT_ASSIGNED',
          entityType: 'Subscription',
          entityId: subscriptionId,
          metadata: { discountId },
        },
        tx
      );

      return assignment;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('CONFLICT', 'Discount is already assigned to this subscription.', 409);
      }
      throw err;
    }
  });
}

export async function removeSubscriptionDiscount(
  subscriptionId: string,
  discountId: string,
  actorId?: string | null
) {
  return prisma.$transaction(async (tx) => {
    // Lock subscription row (section 5.7)
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Subscription" WHERE "id" = ${subscriptionId} FOR UPDATE
    `);

    const deleted = await tx.subscriptionDiscount.deleteMany({
      where: {
        subscriptionId,
        discountId,
      },
    });

    await createAuditLog(
      {
        actorId: actorId ?? null,
        action: 'SUBSCRIPTION_DISCOUNT_REMOVED',
        entityType: 'Subscription',
        entityId: subscriptionId,
        metadata: { discountId },
      },
      tx
    );

    return deleted;
  });
}
