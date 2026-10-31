'use server';

import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireUser, requireRole, assertNoForcedPasswordChange } from '@/lib/auth/guard';
import { mapError, AppError } from '@/lib/errors';
import { transitionSubscription, renewSubscriptionTx } from '@/lib/services/subscriptions/transition';
import { assignSubscriptionDiscount, removeSubscriptionDiscount } from '@/lib/services/discounts';
import { createSubscriptionRequest, reviewSubscriptionRequest } from '@/lib/services/requests';
import { parseBusinessDate } from '@/lib/dates/business-date';
import { round2, toDecimal } from '@/lib/money';
import { TRANSITION_ACTIONS, TransitionAction, REQUEST_TYPES, RequestType } from '@/lib/constants';

// --- CREATE QUOTATION ---
const quotationLineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1),
  taxId: z.string().optional(),
});

const createQuotationSchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  planId: z.string().min(1, 'Plan is required'),
  templateId: z.string().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  expiryDate: z.string().min(1, 'Expiry date is required'),
  lines: z.array(quotationLineSchema).min(1, 'At least one line is required'),
});

export async function createQuotationAction(formData: unknown) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN', 'STAFF');
    assertNoForcedPasswordChange(user);

    const parsed = createQuotationSchema.parse(formData);
    const plan = await prisma.plan.findUnique({ where: { id: parsed.planId } });
    if (!plan) throw new AppError('NOT_FOUND', 'Plan not found', 404);

    const startDate = parseBusinessDate(parsed.startDate);
    const expiryDate = parseBusinessDate(parsed.expiryDate);

    // Build line snapshots (unitPrice = product.salesPrice + variant.priceAdjustment)
    const subLinesData = [];
    for (const l of parsed.lines) {
      const prod = await prisma.product.findUnique({ where: { id: l.productId } });
      if (!prod) throw new AppError('NOT_FOUND', `Product ${l.productId} not found`, 404);

      let unitPrice = toDecimal(prod.salesPrice);
      if (l.variantId) {
        const variant = await prisma.productVariant.findUnique({ where: { id: l.variantId } });
        if (variant) {
          unitPrice = unitPrice.plus(toDecimal(variant.priceAdjustment));
        }
      }

      subLinesData.push({
        productId: l.productId,
        variantId: l.variantId || null,
        quantity: l.quantity,
        unitPrice: round2(unitPrice).toString(),
        taxId: l.taxId || prod.defaultTaxId || null,
      });
    }

    const sub = await prisma.subscription.create({
      data: {
        customerId: parsed.customerId,
        planId: parsed.planId,
        templateId: parsed.templateId || null,
        status: 'DRAFT',
        startDate,
        expiryDate,
        paymentTermsDays: plan.paymentTermsDays,
        createdById: user.id,
        lines: {
          create: subLinesData,
        },
      },
    });

    return { success: true, data: sub };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

// --- TRANSITIONS ---
export async function transitionSubscriptionAction(
  subscriptionId: string,
  action: TransitionAction,
  closeReason?: string
) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN', 'STAFF');
    assertNoForcedPasswordChange(user);

    const result = await transitionSubscription({
      subscriptionId,
      action,
      actorId: user.id,
      closeReason,
    });

    return { success: true, data: result };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

// --- RENEW ---
export async function renewSubscriptionAction(subscriptionId: string) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN', 'STAFF');
    assertNoForcedPasswordChange(user);

    const result = await prisma.$transaction(async (tx) => {
      return renewSubscriptionTx(tx, subscriptionId, user.id);
    });

    return { success: true, data: result };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

// --- ASSIGN & REMOVE SUBSCRIPTION DISCOUNT ---
export async function assignSubscriptionDiscountAction(subscriptionId: string, discountId: string) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN'); // Admin only!
    assertNoForcedPasswordChange(user);

    const res = await assignSubscriptionDiscount(subscriptionId, discountId, user.id);
    return { success: true, data: res };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function removeSubscriptionDiscountAction(subscriptionId: string, discountId: string) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN'); // Admin only!
    assertNoForcedPasswordChange(user);

    const res = await removeSubscriptionDiscount(subscriptionId, discountId, user.id);
    return { success: true, data: res };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

// --- CUSTOMER SELF-SERVICE REQUESTS ---
export async function submitCustomerRequestAction(
  subscriptionId: string,
  requestType: RequestType,
  note?: string
) {
  try {
    const user = await requireUser();
    if (!user.customerId) throw new AppError('FORBIDDEN', 'Only customers can submit requests.', 403);
    assertNoForcedPasswordChange(user);

    const req = await createSubscriptionRequest(user.customerId, subscriptionId, requestType, note);
    return { success: true, data: req };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function reviewCustomerRequestAction(
  requestId: string,
  decision: 'APPROVE' | 'REJECT',
  reviewNote?: string
) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN', 'STAFF');
    assertNoForcedPasswordChange(user);

    const req = await reviewSubscriptionRequest(user.id, requestId, decision, reviewNote);
    return { success: true, data: req };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}
