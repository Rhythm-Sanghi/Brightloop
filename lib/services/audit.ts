import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma';

export interface CreateAuditLogInput {
  actorId?: string | null;
  billingRunId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  metadata?: Prisma.InputJsonValue;
  auditAt?: Date;
}

export async function createAuditLog(
  input: CreateAuditLogInput,
  tx?: Prisma.TransactionClient | PrismaClient
): Promise<void> {
  const client = tx || prisma;
  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      billingRunId: input.billingRunId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      metadata: input.metadata ?? Prisma.DbNull,
      ...(input.auditAt ? { createdAt: input.auditAt } : {}),
    },
  });
}
