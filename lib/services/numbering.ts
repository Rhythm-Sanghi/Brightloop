import { Prisma } from '@prisma/client';

export async function reserveSubscriptionNumber(
  tx: Prisma.TransactionClient
): Promise<string> {
  const result = await tx.$queryRaw<{ lastValue: number }[]>(Prisma.sql`
    UPDATE "SubscriptionCounter"
    SET "lastValue" = "lastValue" + 1
    WHERE "id" = 1
    RETURNING "lastValue"
  `);

  if (!result || result.length === 0) {
    throw new Error('Failed to increment SubscriptionCounter');
  }

  const num = result[0].lastValue;
  return `SUB-${String(num).padStart(6, '0')}`;
}

export async function reserveSubscriptionNumberBlock(
  tx: Prisma.TransactionClient,
  count: number
): Promise<string[]> {
  if (count <= 0) return [];
  const result = await tx.$queryRaw<{ lastValue: number }[]>(Prisma.sql`
    UPDATE "SubscriptionCounter"
    SET "lastValue" = "lastValue" + ${count}
    WHERE "id" = 1
    RETURNING "lastValue"
  `);

  const lastValue = result[0].lastValue;
  const start = lastValue - count + 1;
  const numbers: string[] = [];
  for (let i = start; i <= lastValue; i++) {
    numbers.push(`SUB-${String(i).padStart(6, '0')}`);
  }
  return numbers;
}

export async function reserveInvoiceNumber(
  tx: Prisma.TransactionClient,
  issueYear: number
): Promise<string> {
  const result = await tx.$queryRaw<{ lastValue: number }[]>(Prisma.sql`
    INSERT INTO "InvoiceCounter" ("year", "lastValue")
    VALUES (${issueYear}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "lastValue" = "InvoiceCounter"."lastValue" + EXCLUDED."lastValue"
    RETURNING "lastValue"
  `);

  const num = result[0].lastValue;
  return `INV-${issueYear}-${String(num).padStart(6, '0')}`;
}

export async function reserveInvoiceNumberBlock(
  tx: Prisma.TransactionClient,
  issueYear: number,
  count: number
): Promise<string[]> {
  if (count <= 0) return [];
  const result = await tx.$queryRaw<{ lastValue: number }[]>(Prisma.sql`
    INSERT INTO "InvoiceCounter" ("year", "lastValue")
    VALUES (${issueYear}, ${count})
    ON CONFLICT ("year")
    DO UPDATE SET "lastValue" = "InvoiceCounter"."lastValue" + EXCLUDED."lastValue"
    RETURNING "lastValue"
  `);

  const lastValue = result[0].lastValue;
  const start = lastValue - count + 1;
  const numbers: string[] = [];
  for (let i = start; i <= lastValue; i++) {
    numbers.push(`INV-${issueYear}-${String(i).padStart(6, '0')}`);
  }
  return numbers;
}
