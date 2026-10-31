import Decimal from 'decimal.js';
import { round2 } from '../money';

export interface SubscriptionForMRR {
  id: string;
  status: string;
  billingPeriod: string;
  billingInterval: number;
  startDate: Date;
  expiryDate: Date | null;
  nextBillingDate: Date | null;
  recurringValue: Decimal; // net of discounts that apply at nextBillingDate, before tax
}

export function getMonthlyFactor(billingPeriod: string, billingInterval: number): Decimal {
  const interval = new Decimal(billingInterval);
  switch (billingPeriod) {
    case 'DAILY':
      return new Decimal('30.4375').dividedBy(interval);
    case 'WEEKLY':
      return new Decimal('4.348214').dividedBy(interval);
    case 'MONTHLY':
      return new Decimal(1).dividedBy(interval);
    case 'YEARLY':
      return new Decimal(1).dividedBy(new Decimal(12).times(interval));
    default:
      throw new Error(`Unsupported billing period for MRR: ${billingPeriod}`);
  }
}

export function calculateMRRandARR(subscriptions: SubscriptionForMRR[]): {
  mrrUnrounded: Decimal;
  mrrDisplayed: Decimal;
  arr: Decimal;
} {
  let unroundedSum = new Decimal(0);

  for (const sub of subscriptions) {
    if (sub.status !== 'ACTIVE') continue;
    if (sub.expiryDate && sub.nextBillingDate && sub.nextBillingDate.getTime() > sub.expiryDate.getTime()) {
      // Expired awaiting closure: excluded
      continue;
    }

    const factor = getMonthlyFactor(sub.billingPeriod, sub.billingInterval);
    const normalized = sub.recurringValue.times(factor);
    unroundedSum = unroundedSum.plus(normalized);
  }

  const mrrDisplayed = round2(unroundedSum);
  const arr = round2(mrrDisplayed.times(12));

  return {
    mrrUnrounded: unroundedSum,
    mrrDisplayed,
    arr,
  };
}
