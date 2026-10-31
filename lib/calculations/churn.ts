import Decimal from 'decimal.js';
import { addDays, kolkataMidnightUtc } from '../dates/business-date';

export interface AuditRowForChurn {
  seq: bigint;
  entityId: string;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: Date;
}

export function calculateHistoricalChurn(
  fromDate: Date,
  toDate: Date,
  auditRows: AuditRowForChurn[]
): {
  denominator: number;
  numerator: number;
  churnRatePercent: number;
} {
  const periodStartTs = kolkataMidnightUtc(fromDate);
  const periodEndExclusive = kolkataMidnightUtc(addDays(toDate, 1));

  // Determine status at start for each subscription
  // Filter audit rows before periodStartTs, group by entityId, pick highest seq
  const beforeRows = auditRows.filter((r) => r.createdAt.getTime() < periodStartTs.getTime());
  const latestBefore = new Map<string, AuditRowForChurn>();

  for (const row of beforeRows) {
    const existing = latestBefore.get(row.entityId);
    if (!existing || row.seq > existing.seq) {
      latestBefore.set(row.entityId, row);
    }
  }

  // Denominator: subscriptions whose status at start is ACTIVE or PAUSED
  const cohort = new Set<string>();
  for (const [subId, row] of latestBefore.entries()) {
    if (row.toStatus === 'ACTIVE' || row.toStatus === 'PAUSED') {
      cohort.add(subId);
    }
  }

  const denominator = cohort.size;
  if (denominator === 0) {
    return {
      denominator: 0,
      numerator: 0,
      churnRatePercent: 0,
    };
  }

  // Numerator: cohort members with an audit row whose toStatus is CLOSED and createdAt inside the period
  const closedInPeriod = new Set<string>();
  for (const row of auditRows) {
    const rowTime = row.createdAt.getTime();
    if (
      rowTime >= periodStartTs.getTime() &&
      rowTime < periodEndExclusive.getTime() &&
      row.toStatus === 'CLOSED' &&
      cohort.has(row.entityId)
    ) {
      closedInPeriod.add(row.entityId);
    }
  }

  const numerator = closedInPeriod.size;
  const churn = new Decimal(numerator)
    .dividedBy(denominator)
    .times(100)
    .toDecimalPlaces(1, Decimal.ROUND_HALF_UP);

  return {
    denominator,
    numerator,
    churnRatePercent: churn.toNumber(),
  };
}
