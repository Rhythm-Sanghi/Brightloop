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
  createdAt: Date;
  kind: 'FIXED' | 'PERCENT';
  value: Decimal;
  scope: 'PRODUCT' | 'SUBSCRIPTION';
  startsOn: Date;
  endsOn: Date | null;
  minPurchaseAmount: Decimal | null;
  minQuantity: number | null;
  isActive: boolean;
  maxUses?: number | null;
  timesUsed?: number;
  productIds?: string[];
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

  if (discount.scope === 'PRODUCT') {
    if (!discount.productIds || discount.productIds.length === 0) {
      return false;
    }
  }

  if (linesInScope.length === 0) return false;

  // Minimum purchase check measured against original gross amount before any discounts
  const grossBeforeDiscount = linesInScope.reduce(
    (sum, line) => sum.plus(line.grossAmount),
    new Decimal(0)
  );

  if (discount.minPurchaseAmount && grossBeforeDiscount.lessThan(discount.minPurchaseAmount)) {
    return false;
  }

  // Minimum quantity check measured against original quantity sum
  const totalQuantity = linesInScope.reduce((sum, line) => sum + line.quantity, 0);
  if (discount.minQuantity && totalQuantity < discount.minQuantity) {
    return false;
  }

  if (checkUsage && discount.maxUses !== null && discount.maxUses !== undefined && (discount.timesUsed ?? 0) >= discount.maxUses) {
    return false;
  }

  return true;
}

export async function allocateDiscountsSequential(
  candidateDiscounts: CandidateDiscount[],
  lines: LineForDiscount[],
  issueDate: Date,
  tryIncrementUsage?: (discountId: string) => boolean | Promise<boolean>
): Promise<{
  allocations: DiscountAllocationResult[];
  lineDiscounts: Map<string, Decimal>;
  totalDiscount: Decimal;
}> {
  // Sort candidate discounts by createdAt ASC, id ASC (spec §11.3)
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
    let linesInScope: LineForDiscount[] = [];
    if (discount.scope === 'PRODUCT') {
      if (!discount.productIds || discount.productIds.length === 0) {
        continue;
      }
      linesInScope = lines.filter((l) => discount.productIds!.includes(l.productId));
    } else if (discount.scope === 'SUBSCRIPTION') {
      linesInScope = [...lines];
    } else {
      continue;
    }

    if (linesInScope.length === 0) continue;

    // 2. Check eligibility per spec §11.2 (without usage check, evaluated against original gross & qty)
    if (!isDiscountEligible(discount, linesInScope, issueDate, false)) {
      continue;
    }

    // 3. Remaining base = eligible gross - allocations already accepted on those lines
    const remainingBase = linesInScope.reduce((sum, l) => {
      const rem = remainingPerLine.get(l.id) || new Decimal(0);
      return sum.plus(rem);
    }, new Decimal(0));

    if (remainingBase.lessThanOrEqualTo(0)) {
      continue; // Skip, do not touch usage
    }

    // 4. Compute discount amount per spec §11.3 step 4
    let discountAmount = new Decimal(0);
    if (discount.kind === 'FIXED') {
      discountAmount = Decimal.min(discount.value, remainingBase);
    } else if (discount.kind === 'PERCENT') {
      const calculated = round2(remainingBase.times(discount.value).dividedBy(100));
      discountAmount = Decimal.min(calculated, remainingBase);
    }

    discountAmount = round2(discountAmount);
    if (discountAmount.lessThanOrEqualTo(0)) {
      continue; // Skip, do not touch usage
    }

    // 5. Attempt conditional usage increment (D1, D2)
    if (tryIncrementUsage) {
      const incremented = await tryIncrementUsage(discount.id);
      if (!incremented) {
        // Increment rejected -> contributes nothing, continue to next discount without allocating
        continue;
      }
    } else {
      // In-memory usage check for unit tests
      const currentUsed = discount.timesUsed ?? 0;
      if (discount.maxUses !== null && discount.maxUses !== undefined && currentUsed >= discount.maxUses) {
        continue;
      }
      discount.timesUsed = currentUsed + 1;
    }

    // 6. On acceptance: allocate discount across eligible lines with remaining > 0 (spec §11.3 step 6)
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
