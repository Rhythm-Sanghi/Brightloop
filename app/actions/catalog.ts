'use server';

import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireUser, requireRole, assertNoForcedPasswordChange } from '@/lib/auth/guard';
import { mapError, AppError } from '@/lib/errors';
import { createDiscount, updateDiscount } from '@/lib/services/discounts';
import { parseBusinessDate } from '@/lib/dates/business-date';
import { positiveMoneyInputSchema, moneyInputSchema, round2, toDecimal } from '@/lib/money';
import { BILLING_PERIODS, DISCOUNT_KINDS, DISCOUNT_SCOPES } from '@/lib/constants';

// --- PRODUCTS & VARIANTS ---
const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  type: z.string().default('SERVICE'),
  salesPrice: positiveMoneyInputSchema,
  costPrice: moneyInputSchema,
  notes: z.string().optional(),
  defaultTaxId: z.string().optional(),
});

export async function createProductAction(formData: unknown) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    const parsed = productSchema.parse(formData);
    const product = await prisma.product.create({
      data: {
        name: parsed.name,
        type: parsed.type,
        salesPrice: round2(toDecimal(parsed.salesPrice)).toString(),
        costPrice: round2(toDecimal(parsed.costPrice)).toString(),
        notes: parsed.notes || null,
        defaultTaxId: parsed.defaultTaxId || null,
      },
    });
    return { success: true, data: product };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

const variantSchema = z.object({
  productId: z.string().min(1),
  attribute: z.string().min(1, 'Attribute is required (e.g. Brand)'),
  value: z.string().min(1, 'Value is required (e.g. Odoo)'),
  priceAdjustment: moneyInputSchema,
});

export async function addVariantAction(formData: unknown) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    const parsed = variantSchema.parse(formData);
    const variant = await prisma.productVariant.create({
      data: {
        productId: parsed.productId,
        attribute: parsed.attribute,
        value: parsed.value,
        priceAdjustment: round2(toDecimal(parsed.priceAdjustment)).toString(),
      },
    });
    return { success: true, data: variant };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function toggleProductActiveAction(productId: string, isActive: boolean) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    await prisma.product.update({
      where: { id: productId },
      data: { isActive },
    });
    return { success: true };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

// --- PLANS ---
const planSchema = z.object({
  name: z.string().min(1, 'Plan name is required'),
  billingPeriod: z.enum(BILLING_PERIODS),
  billingInterval: z.number().int().min(1).default(1),
  minimumQuantity: z.number().int().min(1).default(1),
  availableFrom: z.string().min(1),
  availableUntil: z.string().optional(),
  paymentTermsDays: z.number().int().min(0).default(15),
  autoCloseOnExpiry: z.boolean().default(true),
  allowEarlyClose: z.boolean().default(false),
  allowPause: z.boolean().default(false),
  allowRenewal: z.boolean().default(true),
});

export async function createPlanAction(formData: unknown) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    const parsed = planSchema.parse(formData);
    const plan = await prisma.plan.create({
      data: {
        name: parsed.name,
        billingPeriod: parsed.billingPeriod,
        billingInterval: parsed.billingInterval,
        minimumQuantity: parsed.minimumQuantity,
        availableFrom: parseBusinessDate(parsed.availableFrom),
        availableUntil: parsed.availableUntil ? parseBusinessDate(parsed.availableUntil) : null,
        paymentTermsDays: parsed.paymentTermsDays,
        autoCloseOnExpiry: parsed.autoCloseOnExpiry,
        allowEarlyClose: parsed.allowEarlyClose,
        allowPause: parsed.allowPause,
        allowRenewal: parsed.allowRenewal,
      },
    });
    return { success: true, data: plan };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function togglePlanActiveAction(planId: string, isActive: boolean) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    await prisma.plan.update({
      where: { id: planId },
      data: { isActive },
    });
    return { success: true };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

// --- TEMPLATES ---
const templateLineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1).default(1),
});

const templateSchema = z.object({
  name: z.string().min(1, 'Template name is required'),
  planId: z.string().min(1, 'Plan is required'),
  validityDays: z.number().int().min(1).default(30),
  notes: z.string().optional(),
  lines: z.array(templateLineSchema).min(1, 'At least one line item is required'),
});

export async function createTemplateAction(formData: unknown) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    const parsed = templateSchema.parse(formData);
    const template = await prisma.quotationTemplate.create({
      data: {
        name: parsed.name,
        planId: parsed.planId,
        validityDays: parsed.validityDays,
        notes: parsed.notes || null,
        lines: {
          create: parsed.lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId || null,
            quantity: l.quantity,
          })),
        },
      },
    });
    return { success: true, data: template };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

// --- TAXES ---
const taxSchema = z.object({
  name: z.string().min(1, 'Tax name is required'),
  ratePercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Valid tax percent rate required'),
});

export async function createTaxAction(formData: unknown) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    const parsed = taxSchema.parse(formData);
    const rate = round2(toDecimal(parsed.ratePercent));
    if (rate.lessThan(0) || rate.greaterThan(100)) {
      throw new AppError('VALIDATION_FAILED', 'Tax rate must be between 0 and 100.', 422);
    }

    const tax = await prisma.tax.create({
      data: {
        name: parsed.name,
        ratePercent: rate.toString(),
      },
    });
    return { success: true, data: tax };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

// --- DISCOUNTS ---
const discountCreateSchema = z.object({
  name: z.string().min(1, 'Discount name is required'),
  kind: z.enum(DISCOUNT_KINDS),
  value: positiveMoneyInputSchema,
  scope: z.enum(DISCOUNT_SCOPES),
  minPurchaseAmount: moneyInputSchema.optional(),
  minQuantity: z.number().int().min(1).optional(),
  startsOn: z.string().min(1),
  endsOn: z.string().optional(),
  maxUses: z.number().int().min(1).optional(),
  productIds: z.array(z.string()).optional(),
});

export async function createDiscountAction(formData: unknown) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    const parsed = discountCreateSchema.parse(formData);
    const discount = await createDiscount({
      name: parsed.name,
      kind: parsed.kind,
      value: parsed.value,
      scope: parsed.scope,
      minPurchaseAmount: parsed.minPurchaseAmount || null,
      minQuantity: parsed.minQuantity || null,
      startsOn: parseBusinessDate(parsed.startsOn),
      endsOn: parsed.endsOn ? parseBusinessDate(parsed.endsOn) : null,
      maxUses: parsed.maxUses || null,
      productIds: parsed.productIds,
      actorId: user.id,
    });
    return { success: true, data: discount };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function updateDiscountAction(formData: unknown) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    const schema = z.object({
      id: z.string().min(1),
      name: z.string().optional(),
      kind: z.enum(DISCOUNT_KINDS).optional(),
      value: positiveMoneyInputSchema.optional(),
      scope: z.enum(DISCOUNT_SCOPES).optional(),
      minPurchaseAmount: moneyInputSchema.optional(),
      minQuantity: z.number().int().optional(),
      startsOn: z.string().optional(),
      endsOn: z.string().optional(),
      maxUses: z.number().int().optional(),
      isActive: z.boolean().optional(),
      productIds: z.array(z.string()).optional(),
    });

    const parsed = schema.parse(formData);
    const discount = await updateDiscount({
      id: parsed.id,
      name: parsed.name,
      kind: parsed.kind,
      value: parsed.value,
      scope: parsed.scope,
      minPurchaseAmount: parsed.minPurchaseAmount || null,
      minQuantity: parsed.minQuantity || null,
      startsOn: parsed.startsOn ? parseBusinessDate(parsed.startsOn) : undefined,
      endsOn: parsed.endsOn ? parseBusinessDate(parsed.endsOn) : undefined,
      maxUses: parsed.maxUses,
      isActive: parsed.isActive,
      productIds: parsed.productIds,
      actorId: user.id,
    });
    return { success: true, data: discount };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}
