import { Prisma } from '@prisma/client';

export function eligibleDueSqlCondition(runDate: Date): Prisma.Sql {
  return Prisma.sql`
    s."status" = 'ACTIVE'
    AND s."nextBillingDate" <= ${runDate}
    AND (
      s."expiryDate" IS NULL
      OR s."nextBillingDate" <= s."expiryDate"
      OR p."autoCloseOnExpiry" = true
    )
  `;
}
