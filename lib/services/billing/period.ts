import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { addDays, addUnits, getPeriodDates } from '../../dates/business-date';
import { transitionSubscriptionTx } from '../subscriptions/transition';
import { createAuditLog } from '../audit';
import {
  allocateDiscountsSequential,
  CandidateDiscount,
  LineForDiscount,
} from '../../calculations/discounts';
import { calculateInvoiceTotals, RawInvoiceLineInput } from '../../calculations/invoice';
import { toDecimal } from '../../money';
import { AppError } from '../../errors';

export type PeriodResultType =
  | 'INVOICE_CREATED'
  | 'REPAIRED'
  | 'NOT_DUE'
  | 'EXPIRED_CLOSED'
  | 'EXPIRED_AWAITING'
  | 'FAILED';

export interface RunPeriodResult {
  type: PeriodResultType;
  reason?: string;
  invoiceId?: string;
  periodIndex?: number;
  errorCode?: string;
}

export interface BillingTestOptions {
  faultInjection?: (subscriptionId: string, periodIndex: number) => boolean;
  throwAtPeriodIndex?: number;
  throwAfterDiscountIncrement?: boolean;
  isRetry?: boolean;
  allowRepair?: boolean;
  onTryIncrementReady?: (cb: (discountId: string) => Promise<boolean>) => void;
}

export function isInvoicePeriodDuplicateError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return (
      target.length === 2 &&
      target.includes('subscriptionId') &&
      target.includes('periodStart')
    );
  }
  if (typeof target === 'string') {
    return (
      target === 'Invoice_subscriptionId_periodStart_key' ||
      target.includes('subscriptionId_periodStart')
    );
  }
  return false;
}

export async function runPeriod(
  subscriptionId: string,
  billingRunId: string,
  runDate: Date,
  testOptions?: BillingTestOptions,
  auditAt?: Date
): Promise<RunPeriodResult> {
  const maxAttempts = 3;
  let attempt = 0;
  const allowRepair = testOptions?.allowRepair ?? true;
  const isRetry = testOptions?.isRetry ?? false;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await prisma.$transaction(
        async (tx) => {
          let txClosed = false;

          try {
            // 1. Lock and load subscription
            const lockedRows = await tx.$queryRaw<
              {
                id: string;
                customerId: string;
                status: string;
                planId: string;
                startDate: Date;
                expiryDate: Date | null;
                nextBillingDate: Date | null;
                billingCycleIndex: number;
                paymentTermsDays: number;
              }[]
            >(Prisma.sql`
              SELECT "id", "customerId", "status", "planId", "startDate", "expiryDate", "nextBillingDate", "billingCycleIndex", "paymentTermsDays"
              FROM "Subscription"
              WHERE "id" = ${subscriptionId}
              FOR UPDATE
            `);

            if (!lockedRows || lockedRows.length === 0) {
              return { type: 'FAILED', reason: 'Subscription not found' };
            }
            const sub = lockedRows[0];

            // 2. Status check
            if (sub.status !== 'ACTIVE') {
              return { type: 'NOT_DUE', reason: 'STATE_CHANGED' };
            }

            // Load plan
            const plan = await tx.plan.findUnique({ where: { id: sub.planId } });
            if (!plan) {
              return { type: 'FAILED', reason: 'Plan not found' };
            }

            // 4. Compute periodStart and periodEnd
            const cycleIdx = sub.billingCycleIndex;
            const { periodStart, periodEnd } = getPeriodDates(
              sub.startDate,
              plan.billingPeriod,
              plan.billingInterval,
              cycleIdx
            );

            // Check if subscription has reached or passed expiry (spec §10.2)
            if (sub.expiryDate && sub.expiryDate.getTime() <= runDate.getTime()) {
              if (periodStart.getTime() > sub.expiryDate.getTime()) {
                if (plan.autoCloseOnExpiry) {
                  await transitionSubscriptionTx(tx, {
                    subscriptionId: sub.id,
                    action: 'EXPIRY_CLOSE',
                    actorId: null,
                    billingRunId,
                    closeReason: 'EXPIRED',
                    todayOverride: runDate,
                    asOfDate: runDate,
                    auditAt,
                  });
                  return { type: 'EXPIRED_CLOSED', periodIndex: cycleIdx };
                } else {
                  return { type: 'EXPIRED_AWAITING', periodIndex: cycleIdx };
                }
              }
            }

            // 3. Due check
            if (!sub.nextBillingDate || sub.nextBillingDate.getTime() > runDate.getTime()) {
              return { type: 'NOT_DUE', reason: 'ALREADY_CURRENT' };
            }

            if (sub.nextBillingDate.getTime() !== periodStart.getTime()) {
              throw new AppError('DATA_INCONSISTENT', 'nextBillingDate does not match periodStart', 422);
            }

            // Consistency check for mismatched existing invoices at cycle index 0 (R8)
            if (cycleIdx === 0) {
              const existingAtZero = await tx.invoice.findFirst({
                where: { subscriptionId: sub.id },
              });
              if (existingAtZero && existingAtZero.periodStart.getTime() !== periodStart.getTime()) {
                throw new AppError(
                  'DATA_INCONSISTENT',
                  'Invoice period does not match expected cycle start',
                  422
                );
              }
            }

            // Test fault injection at period index
            if (testOptions?.throwAtPeriodIndex !== undefined && cycleIdx === testOptions.throwAtPeriodIndex) {
              throw new Error('FAULT_AT_PERIOD_INDEX');
            }

            // Test fault injection for B13
            if (testOptions?.faultInjection?.(sub.id, cycleIdx)) {
              throw new Error('FAULT_INJECTED');
            }

            // 5. Period boundary rules
            if (sub.expiryDate && periodStart.getTime() > sub.expiryDate.getTime()) {
              if (plan.autoCloseOnExpiry) {
                await transitionSubscriptionTx(tx, {
                  subscriptionId: sub.id,
                  action: 'EXPIRY_CLOSE',
                  actorId: null,
                  billingRunId,
                  closeReason: 'EXPIRED',
                  todayOverride: runDate,
                  asOfDate: runDate,
                  auditAt,
                });
                return { type: 'EXPIRED_CLOSED', periodIndex: cycleIdx };
              } else {
                return { type: 'EXPIRED_AWAITING', periodIndex: cycleIdx };
              }
            }

            // 6. Duplicate check (spec §10.5 step 6 & prompt D4)
            const existingInvoice = await tx.invoice.findFirst({
              where: {
                subscriptionId: sub.id,
                periodStart,
              },
            });

            if (existingInvoice) {
              // First, check whether existing invoice matches periodStart(billingCycleIndex) exactly
              if (existingInvoice.periodStart.getTime() !== periodStart.getTime()) {
                throw new AppError(
                  'DATA_INCONSISTENT',
                  'Invoice period does not match expected cycle start',
                  422
                );
              }

              // Only a match is subject to the repair budget (D4)
              if (!allowRepair) {
                await createAuditLog(
                  {
                    billingRunId,
                    action: 'BILLING_PERIOD',
                    entityType: 'Subscription',
                    entityId: sub.id,
                    metadata: {
                      result: 'FAILED',
                      errorCode: 'REPAIR_LIMIT_EXCEEDED',
                      message: 'Repair limit exceeded for subscription',
                    },
                    ...(auditAt ? { auditAt } : {}),
                  },
                  tx
                );
                return {
                  type: 'FAILED',
                  errorCode: 'REPAIR_LIMIT_EXCEEDED',
                  reason: 'Repair limit exceeded for subscription',
                };
              }

              const nextCycleStart = addUnits(
                sub.startDate,
                plan.billingPeriod,
                plan.billingInterval,
                cycleIdx + 1
              );
              await tx.subscription.update({
                where: { id: sub.id },
                data: {
                  billingCycleIndex: cycleIdx + 1,
                  nextBillingDate: nextCycleStart,
                },
              });

              await createAuditLog(
                {
                  billingRunId,
                  action: 'BILLING_PERIOD',
                  entityType: 'Subscription',
                  entityId: sub.id,
                  metadata: {
                    result: 'REPAIRED',
                    periodIndex: cycleIdx,
                    periodStart: periodStart.toISOString(),
                    periodEnd: periodEnd.toISOString(),
                  },
                  ...(auditAt ? { auditAt } : {}),
                },
                tx
              );

              return { type: 'REPAIRED', periodIndex: cycleIdx };
            }

            // 7. Build the invoice
            const lines = await tx.subscriptionLine.findMany({
              where: { subscriptionId: sub.id },
              include: { product: true, tax: true },
            });

            // Load candidate discounts
            const assignedSubscriptionDiscounts = await tx.subscriptionDiscount.findMany({
              where: { subscriptionId: sub.id },
              include: { discount: true },
            });

            const productIdsOnLines = lines.map((l) => l.productId);
            const productDiscounts = await tx.discount.findMany({
              where: {
                scope: 'PRODUCT',
                isActive: true,
                products: {
                  some: {
                    productId: { in: productIdsOnLines },
                  },
                },
              },
              include: {
                products: true,
              },
            });

            const candidateDiscounts: CandidateDiscount[] = [];

            // Add subscription-scoped discounts
            for (const sd of assignedSubscriptionDiscounts) {
              candidateDiscounts.push({
                id: sd.discount.id,
                name: sd.discount.name,
                kind: sd.discount.kind as 'FIXED' | 'PERCENT',
                value: toDecimal(sd.discount.value),
                scope: 'SUBSCRIPTION',
                minPurchaseAmount: sd.discount.minPurchaseAmount
                  ? toDecimal(sd.discount.minPurchaseAmount)
                  : null,
                minQuantity: sd.discount.minQuantity,
                startsOn: sd.discount.startsOn,
                endsOn: sd.discount.endsOn,
                maxUses: sd.discount.maxUses,
                timesUsed: sd.discount.timesUsed,
                isActive: sd.discount.isActive,
                createdAt: sd.discount.createdAt,
              });
            }

            // Add product-scoped discounts
            for (const pd of productDiscounts) {
              candidateDiscounts.push({
                id: pd.id,
                name: pd.name,
                kind: pd.kind as 'FIXED' | 'PERCENT',
                value: toDecimal(pd.value),
                scope: 'PRODUCT',
                productIds: pd.products.map((p) => p.productId),
                minPurchaseAmount: pd.minPurchaseAmount ? toDecimal(pd.minPurchaseAmount) : null,
                minQuantity: pd.minQuantity,
                startsOn: pd.startsOn,
                endsOn: pd.endsOn,
                maxUses: pd.maxUses,
                timesUsed: pd.timesUsed,
                isActive: pd.isActive,
                createdAt: pd.createdAt,
              });
            }

            const linesForDiscount: LineForDiscount[] = lines.map((l, idx) => ({
              id: l.id,
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: toDecimal(l.unitPrice),
              grossAmount: toDecimal(l.unitPrice).times(l.quantity),
              sortOrder: idx,
            }));

            // Injected callback for conditional increment with lifetime flag (R24)
            const tryIncrementUsage = async (discountId: string): Promise<boolean> => {
              if (txClosed) {
                throw new Error('Transaction callback invoked after transaction closed');
              }
              const updated = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
                UPDATE "Discount"
                SET "timesUsed" = "timesUsed" + 1
                WHERE "id" = ${discountId}
                  AND ("maxUses" IS NULL OR "timesUsed" < "maxUses")
                RETURNING "id"
              `);
              return updated.length > 0;
            };

            if (testOptions?.onTryIncrementReady) {
              testOptions.onTryIncrementReady(tryIncrementUsage);
            }

            // Sequential evaluation with conditional increment inside transaction
            const { allocations, lineDiscounts } = await allocateDiscountsSequential(
              candidateDiscounts,
              linesForDiscount,
              runDate,
              tryIncrementUsage
            );

            // Test fault injection after discount increments (R5)
            if (testOptions?.throwAfterDiscountIncrement) {
              throw new Error('FAULT_AFTER_DISCOUNT_INCREMENT');
            }

            // Build raw invoice lines from accepted allocations only
            const issueDate = runDate;
            const dueDate = addDays(issueDate, sub.paymentTermsDays);

            const rawLines: RawInvoiceLineInput[] = lines.map((l, idx) => {
              const allocatedDiscount = lineDiscounts.get(l.id) || toDecimal(0);
              const taxRatePercent = l.tax ? toDecimal(l.tax.ratePercent) : toDecimal(0);
              return {
                productId: l.productId,
                variantId: l.variantId,
                description: l.product.name,
                quantity: l.quantity,
                unitPrice: toDecimal(l.unitPrice),
                allocatedDiscount,
                taxRatePercent,
                taxId: l.taxId,
                sortOrder: idx,
              };
            });

            const totals = calculateInvoiceTotals(rawLines);

            // Assert invariant: subtotal - discountTotal == taxableTotal
            if (!totals.subtotal.minus(totals.discountTotal).equals(totals.taxableTotal)) {
              throw new AppError(
                'DATA_INCONSISTENT',
                'Financial invariant violated: subtotal - discountTotal <> taxableTotal',
                422
              );
            }

            // 8. Insert Invoice with lines and InvoiceDiscount rows (only accepted with positive amount)
            const acceptedAllocationsWithAmount = allocations.filter((a) =>
              a.amount.greaterThan(0)
            );

            const invoice = await tx.invoice.create({
              data: {
                subscriptionId: sub.id,
                customerId: sub.customerId,
                status: 'DRAFT',
                number: null,
                periodStart,
                periodEnd,
                issueDate,
                dueDate,
                ...(auditAt ? { createdAt: auditAt } : {}),
                subtotal: totals.subtotal.toString(),
                discountTotal: totals.discountTotal.toString(),
                taxableTotal: totals.taxableTotal.toString(),
                taxTotal: totals.taxTotal.toString(),
                total: totals.total.toString(),
                amountPaid: '0.00',
                lines: {
                  create: totals.lines.map((tl) => ({
                    productId: tl.productId,
                    variantId: tl.variantId,
                    description: tl.description,
                    quantity: tl.quantity,
                    unitPrice: tl.unitPrice.toString(),
                    grossAmount: tl.grossAmount.toString(),
                    allocatedDiscount: tl.allocatedDiscount.toString(),
                    taxableAmount: tl.taxableAmount.toString(),
                    taxId: tl.taxId,
                    taxRatePercent: tl.taxRatePercent.toString(),
                    taxAmount: tl.taxAmount.toString(),
                    sortOrder: tl.sortOrder,
                  })),
                },
                discounts: {
                  create: acceptedAllocationsWithAmount.map((a) => ({
                    discountId: a.discountId,
                    amount: a.amount.toString(),
                  })),
                },
              },
            });

            // 9. Advance cursor
            const nextPeriodStart = addUnits(
              sub.startDate,
              plan.billingPeriod,
              plan.billingInterval,
              cycleIdx + 1
            );

            await tx.subscription.update({
              where: { id: sub.id },
              data: {
                billingCycleIndex: cycleIdx + 1,
                nextBillingDate: nextPeriodStart,
              },
            });

            // 10. Audit row: GENERATED
            await createAuditLog(
              {
                billingRunId,
                action: 'BILLING_PERIOD',
                entityType: 'Subscription',
                entityId: sub.id,
                metadata: {
                  result: 'GENERATED',
                  invoiceId: invoice.id,
                  periodIndex: cycleIdx,
                  periodStart: periodStart.toISOString(),
                  periodEnd: periodEnd.toISOString(),
                },
                ...(auditAt ? { auditAt } : {}),
              },
              tx
            );

            return {
              type: 'INVOICE_CREATED',
              invoiceId: invoice.id,
              periodIndex: cycleIdx,
            };
          } finally {
            txClosed = true;
          }
        },
        { timeout: 15000, maxWait: 10000 }
      );
    } catch (err: unknown) {
      if (err instanceof AppError && err.code === 'DATA_INCONSISTENT') {
        await createAuditLog({
          billingRunId,
          action: 'BILLING_PERIOD',
          entityType: 'Subscription',
          entityId: subscriptionId,
          metadata: {
            result: 'FAILED',
            errorCode: 'DATA_INCONSISTENT',
            message: err.message,
          },
          ...(auditAt ? { auditAt } : {}),
        });
        return {
          type: 'FAILED',
          errorCode: 'DATA_INCONSISTENT',
          reason: err.message,
        };
      }

      const error = err as { code?: string; message?: string };
      // P2034: transaction write conflict/deadlock -> retry up to 3 times
      if (error?.code === 'P2034') {
        if (attempt < maxAttempts) {
          const delay = attempt === 1 ? 250 : 500;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        return {
          type: 'FAILED',
          errorCode: 'CONFLICT',
          reason: 'Transaction conflict after retries',
        };
      }

      // P2002: unique constraint -> check structured target
      if (error?.code === 'P2002') {
        if (isInvoicePeriodDuplicateError(err)) {
          if (!isRetry) {
            return await runPeriod(
              subscriptionId,
              billingRunId,
              runDate,
              { ...testOptions, isRetry: true, allowRepair },
              auditAt
            );
          } else {
            await createAuditLog({
              billingRunId,
              action: 'BILLING_PERIOD',
              entityType: 'Subscription',
              entityId: subscriptionId,
              metadata: {
                result: 'FAILED',
                errorCode: 'DUPLICATE_INVOICE_PERIOD',
                message: 'Duplicate invoice period on retry',
              },
              ...(auditAt ? { auditAt } : {}),
            });
            return {
              type: 'FAILED',
              errorCode: 'DUPLICATE_INVOICE_PERIOD',
              reason: 'Duplicate invoice period on retry',
            };
          }
        } else {
          // Unrelated unique violation
          await createAuditLog({
            billingRunId,
            action: 'BILLING_PERIOD',
            entityType: 'Subscription',
            entityId: subscriptionId,
            metadata: {
              result: 'FAILED',
              errorCode: error.code || 'P2002',
              message: error.message || 'Unique constraint violation',
            },
            ...(auditAt ? { auditAt } : {}),
          });
          return {
            type: 'FAILED',
            errorCode: error.code || 'P2002',
            reason: error.message || 'Unique constraint violation',
          };
        }
      }

      // Any other error: write audit row outside rolled back transaction
      await createAuditLog({
        billingRunId,
        action: 'BILLING_PERIOD',
        entityType: 'Subscription',
        entityId: subscriptionId,
        metadata: {
          result: 'FAILED',
          errorCode: error?.code || 'INTERNAL_ERROR',
          message: error?.message || 'Period billing failed',
        },
        ...(auditAt ? { auditAt } : {}),
      });

      return {
        type: 'FAILED',
        errorCode: error?.code || 'INTERNAL_ERROR',
        reason: error?.message || 'Period billing failed',
      };
    }
  }

  return { type: 'FAILED', errorCode: 'MAX_ATTEMPTS_EXCEEDED' };
}
