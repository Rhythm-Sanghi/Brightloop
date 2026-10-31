import { addUnits } from '../../dates/business-date';

export interface RemainingDueResult {
  remainingDuePeriods: number;
  overflow: boolean;
}

export function countRemainingDuePeriods(
  startDate: Date,
  period: string,
  interval: number,
  billingCycleIndex: number,
  runDate: Date,
  expiryDate: Date | null,
  maxSteps = 10000
): RemainingDueResult {
  let count = 0;
  let i = billingCycleIndex;

  while (count < maxSteps) {
    const periodStart = addUnits(startDate, period, interval, i);
    // If periodStart > runDate, no longer due
    if (periodStart.getTime() > runDate.getTime()) {
      break;
    }
    // If expiryDate is set and periodStart > expiryDate, past expiry
    if (expiryDate && periodStart.getTime() > expiryDate.getTime()) {
      break;
    }

    count++;
    i++;
  }

  if (count >= maxSteps) {
    return { remainingDuePeriods: count, overflow: true };
  }

  return { remainingDuePeriods: count, overflow: false };
}
