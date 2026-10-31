import Decimal from 'decimal.js';
import { round2, toDecimal } from '../money';

export interface LineForDiscount {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: Decimal;
  grossAmount: Decimal;
  sortOrder: number;
}

export interface CandidateDiscount {
  id: string;
  name: string;
  kind: 'FIXED' | 'PERCENT';
  value: Decimal;
  scope: 'PRODUCT' | 'SUBSCRIPTION';
  minPurchaseAmount: Decimal | null;
  minQuantity: number | null;
  startsOn: Date;
  endsOn: Date | null;
  maxUses: number | null;
  timesUsed: number;
  isActive: boolean;
  createdAt: Date;
  productIds?: string[]; // For PRODUCT scope
}

export interface DiscountAllocationResult {
  discountId: string;
  amount: Decimal;
  lineAllocations: { lineId: string; amount: Decimal }[];
}

export function isDiscountEligible(
  discount: CandidateDiscount,
  linesInScope: LineForDiscount[],
  issueDate: Date,
  checkUsage = true
): boolean {
  if (!discount.isActive) return false;

  const issueTime = issueDate.getTime();
  const startTime = discount.startsOn.getTime();
  if (issueTime < startTime) return false;
  if (discount.endsOn && issueTime > discount.endsOn.getTime()) return false;

  if (linesInScope.length === 0) return false;

  // Minimum purchase check measured before any discounts
  const grossBeforeDiscount = linesInScope.reduce(
    (sum, line) => sum.plus(line.grossAmount),
    new Decimal(0)
  );

  if (discount.minPurchaseAmount && grossBeforeDiscount.lessThan(discount.minPurchaseAmount)) {
    return false;
  }

  // Minimum quantity check
  const totalQuantity = linesInScope.reduce((sum, line) => sum + line.quantity, 0);
  if (discount.minQuantity && totalQuantity < discount.minQuantity) {
    return false;
  }

  if (checkUsage && discount.maxUses !== null && discount.timesUsed >= discount.maxUses) {
    return false;
  }

  return true;
}

export function allocateDiscountsSequential(
  candidateDiscounts: CandidateDiscount[],
  lines: LineForDiscount[],
  issueDate: Date,
  tryIncrementUsage?: (discountId: string) => boolean | Promise<boolean>
): {
  allocations: DiscountAllocationResult[];
  lineDiscounts: Map<string, Decimal>;
  totalDiscount: Decimal;
} {
  // Sort candidate discounts by createdAt, then id
  const sortedDiscounts = [...candidateDiscounts].sort((a, b) => {
    const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });

  // Track remaining gross amount per line
  const remainingPerLine = new Map<string, Decimal>();
  for (const line of lines) {
    remainingPerLine.set(line.id, line.grossAmount);
  }

  const lineDiscounts = new Map<string, Decimal>();
  for (const line of lines) {
    lineDiscounts.set(line.id, new Decimal(0));
  }

  const allocations: DiscountAllocationResult[] = [];
  let totalDiscount = new Decimal(0);

  for (const discount of sortedDiscounts) {
    // 1. Identify lines in scope
    const linesInScope = lines.filter((l) => {
      if (discount.scope === 'SUBSCRIPTION') return true;
      if (discount.scope === 'PRODUCT') {
        return discount.productIds?.includes(l.productId);
      }
      return false;
    });

    if (linesInScope.length === 0) continue;

    // Remaining base = eligible gross - allocations already made to those lines
    const remainingBase = linesInScope.reduce((sum, l) => {
      const rem = remainingPerLine.get(l.id) || new Decimal(0);
      return sum.plus(rem);
    }, new Decimal(0));

    // 2. If candidate fails eligibility (without checking usage yet), skip it
    if (!isDiscountEligible(discount, linesInScope, issueDate, false)) {
      continue;
    }

    // 3. If remaining base is zero, skip it
    if (remainingBase.lessThanOrEqualTo(0)) {
      continue;
    }

    // 4. Compute discount amount
    let discountAmount = new Decimal(0);
    if (discount.kind === 'FIXED') {
      discountAmount = Decimal.min(discount.value, remainingBase);
    } else if (discount.kind === 'PERCENT') {
      const calculated = round2(remainingBase.times(discount.value).dividedBy(100));
      discountAmount = Decimal.min(calculated, remainingBase);
    }

    discountAmount = round2(discountAmount);
    if (discountAmount.lessThanOrEqualTo(0)) {
      continue;
    }

    // 5. Attempt conditional usage increment if provided, or check local maxUses
    if (tryIncrementUsage) {
      const incremented = tryIncrementUsage(discount.id);
      if (!incremented) {
        continue;
      }
    } else {
      if (discount.maxUses !== null && discount.timesUsed >= discount.maxUses) {
        continue;
      }
      discount.timesUsed += 1;
    }

    // 6. Allocate discount across eligible lines in proportion to remaining amount
    const eligibleLinesWithRemaining = linesInScope
      .filter((l) => (remainingPerLine.get(l.id) || new Decimal(0)).greaterThan(0))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (eligibleLinesWithRemaining.length === 0) continue;

    let allocatedSum = new Decimal(0);
    const lineAllocMap = new Map<string, Decimal>();

    for (let i = 0; i < eligibleLinesWithRemaining.length - 1; i++) {
      const line = eligibleLinesWithRemaining[i];
      const lineRem = remainingPerLine.get(line.id)!;
      const proportion = lineRem.dividedBy(remainingBase);
      let lineAlloc = round2(discountAmount.times(proportion));
      if (lineAlloc.greaterThan(lineRem)) {
        lineAlloc = lineRem;
      }
      lineAllocMap.set(line.id, lineAlloc);
      allocatedSum = allocatedSum.plus(lineAlloc);
    }

    // Last eligible line takes the rounding remainder
    const lastLine = eligibleLinesWithRemaining[eligibleLinesWithRemaining.length - 1];
    const lastLineRem = remainingPerLine.get(lastLine.id)!;
    let remainder = discountAmount.minus(allocatedSum);

    if (remainder.greaterThan(lastLineRem)) {
      lineAllocMap.set(lastLine.id, lastLineRem);
      let leftover = remainder.minus(lastLineRem);
      // Distribute leftover cent by cent to earlier lines with spare capacity
      const cent = new Decimal('0.01');
      for (const line of eligibleLinesWithRemaining) {
        if (leftover.lessThanOrEqualTo(0)) break;
        const currentAlloc = lineAllocMap.get(line.id) || new Decimal(0);
        const capacity = (remainingPerLine.get(line.id) || new Decimal(0)).minus(currentAlloc);
        if (capacity.greaterThanOrEqualTo(cent)) {
          const addition = Decimal.min(capacity, leftover);
          lineAllocMap.set(line.id, currentAlloc.plus(addition));
          leftover = leftover.minus(addition);
        }
      }
    } else {
      lineAllocMap.set(lastLine.id, remainder);
    }

    // Apply allocations to tracking maps
    const currentAllocations: { lineId: string; amount: Decimal }[] = [];
    for (const [lineId, amt] of lineAllocMap.entries()) {
      const lineRem = remainingPerLine.get(lineId)!;
      remainingPerLine.set(lineId, lineRem.minus(amt));
      const currentLineDiscount = lineDiscounts.get(lineId)!;
      lineDiscounts.set(lineId, currentLineDiscount.plus(amt));
      currentAllocations.push({ lineId, amount: amt });
    }

    allocations.push({
      discountId: discount.id,
      amount: discountAmount,
      lineAllocations: currentAllocations,
    });

    totalDiscount = totalDiscount.plus(discountAmount);
  }

  return {
    allocations,
    lineDiscounts,
    totalDiscount: round2(totalDiscount),
  };
}
