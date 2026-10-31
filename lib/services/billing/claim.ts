import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { eligibleDueSqlCondition } from './eligibility';

export async function claimNext(
  runDate: Date,
  cursor: string,
  excluded: string[] = []
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const excludedSql =
      excluded.length > 0
        ? Prisma.sql`AND s."id" NOT IN (${Prisma.join(excluded)})`
        : Prisma.empty;

    const condition = eligibleDueSqlCondition(runDate);

    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT s."id"
      FROM "Subscription" s
      JOIN "Plan" p ON p."id" = s."planId"
      WHERE ${condition}
        AND s."id" > ${cursor}
        ${excludedSql}
      ORDER BY s."id"
      LIMIT 1
      FOR UPDATE OF s SKIP LOCKED
    `);

    if (rows.length === 0) {
      return null;
    }

    return rows[0].id;
  });
}
