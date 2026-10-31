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
}

export async function runPeriod(
  subscriptionId: string,
  billingRunId: string,
  runDate: Date,
  testOptions?: BillingTestOptions
): Promise<RunPeriodResult> {
  const maxAttempts = 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await prisma.$transaction(
        async (tx) => {
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

          // 3. Due check
          if (!sub.nextBillingDate || sub.nextBillingDate.getTime() > runDate.getTime()) {
            return { type: 'NOT_DUE', reason: 'ALREADY_CURRENT' };
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

          if (sub.nextBillingDate.getTime() !== periodStart.getTime()) {
            throw new Error('DATA_INCONSISTENT');
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
              });
              return { type: 'EXPIRED_CLOSED', periodIndex: cycleIdx };
            } else {
              return { type: 'EXPIRED_AWAITING', periodIndex: cycleIdx };
            }
          }

          // 6. Duplicate check
          const existingInvoice = await tx.invoice.findFirst({
            where: {
              subscriptionId: sub.id,
              periodStart,
            },
          });

          if (existingInvoice) {
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

          // Run sequential discount allocation with synchronous usage check
          // and immediate DB conditional increment
          const tryIncrementUsage = async (discountId: string): Promise<boolean> => {
            const updated = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
              UPDATE "Discount"
              SET "timesUsed" = "timesUsed" + 1
              WHERE "id" = ${discountId}
                AND ("maxUses" IS NULL OR "timesUsed" < "maxUses")
              RETURNING "id"
            `);
            return updated.length > 0;
          };

          // Since allocateDiscountsSequential is synchronous, we first filter eligible and do increments:
          // We can do sequential evaluation:
          const { allocations, lineDiscounts } = allocateDiscountsSequential(
            candidateDiscounts,
            linesForDiscount,
            runDate
          );

          // For each applied discount that contributed > 0, do the conditional increment
          const acceptedAllocations = [];
          for (const alloc of allocations) {
            if (alloc.amount.greaterThan(0)) {
              const incremented = await tryIncrementUsage(alloc.discountId);
              if (incremented) {
                acceptedAllocations.push(alloc);
              }
            }
          }

          // Build raw invoice lines
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

          // 8. Insert Invoice with lines and InvoiceDiscount rows
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
                create: acceptedAllocations.map((a) => ({
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
            },
            tx
          );

          return {
            type: 'INVOICE_CREATED',
            invoiceId: invoice.id,
            periodIndex: cycleIdx,
          };
        },
        { timeout: 15000, maxWait: 10000 }
      );
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      // P2034: transaction write conflict/deadlock -> retry up to 3 times
      if (error?.code === 'P2034') {
        if (attempt < maxAttempts) {
          const delay = attempt === 1 ? 250 : 500;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        return { type: 'FAILED', errorCode: 'CONFLICT', reason: 'Transaction conflict after retries' };
      }

      // P2002: unique constraint -> run duplicate check / repair
      if (error?.code === 'P2002') {
        // Attempt duplicate repair check
        try {
          return await prisma.$transaction(async (tx) => {
            const sub = await tx.subscription.findUnique({
              where: { id: subscriptionId },
              include: { plan: true },
            });
            if (!sub) return { type: 'FAILED', errorCode: 'DUPLICATE_INVOICE_PERIOD' };
            const { periodStart, periodEnd } = getPeriodDates(
              sub.startDate,
              sub.plan.billingPeriod,
              sub.plan.billingInterval,
              sub.billingCycleIndex
            );
            const dup = await tx.invoice.findFirst({
              where: { subscriptionId: sub.id, periodStart },
            });
            if (dup) {
              const nextStart = addUnits(
                sub.startDate,
                sub.plan.billingPeriod,
                sub.plan.billingInterval,
                sub.billingCycleIndex + 1
              );
              await tx.subscription.update({
                where: { id: sub.id },
                data: {
                  billingCycleIndex: sub.billingCycleIndex + 1,
                  nextBillingDate: nextStart,
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
                    periodIndex: sub.billingCycleIndex,
                    periodStart: periodStart.toISOString(),
                    periodEnd: periodEnd.toISOString(),
                  },
                },
                tx
              );
              return { type: 'REPAIRED', periodIndex: sub.billingCycleIndex };
            }
            return { type: 'FAILED', errorCode: 'DUPLICATE_INVOICE_PERIOD' };
          });
        } catch {
          return { type: 'FAILED', errorCode: 'DUPLICATE_INVOICE_PERIOD' };
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
          errorCode: error?.code || 'ERROR',
          message: 'Period billing failed',
        },
      });

      return {
        type: 'FAILED',
        errorCode: error?.code || 'ERROR',
        reason: error?.message || 'Period billing failed',
      };
    }
  }

  return { type: 'FAILED', errorCode: 'MAX_ATTEMPTS_EXCEEDED' };
}
