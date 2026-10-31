import { Prisma } from '@prisma/client';

export function formatBusinessDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTimestamp(date: Date | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toISOString();
}

export function formatMoney(val: Prisma.Decimal | number | string | null | undefined): string {
  if (val === null || val === undefined) return '0.00';
  if (typeof val === 'object' && 'toFixed' in val) {
    return val.toFixed(2);
  }
  const num = typeof val === 'string' ? parseFloat(val) : Number(val);
  return isNaN(num) ? '0.00' : num.toFixed(2);
}

export function serializeAuditLog(log: {
  id: string;
  seq: bigint;
  actorId: string | null;
  actor?: { id: string; name: string; email: string } | null;
  billingRunId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  fromStatus: string | null;
  toStatus: string | null;
  metadata: unknown;
  createdAt: Date;
}) {
  return {
    id: log.id,
    seq: log.seq.toString(),
    actorId: log.actorId,
    actor: log.actor ? { id: log.actor.id, name: log.actor.name, email: log.actor.email } : null,
    billingRunId: log.billingRunId,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    fromStatus: log.fromStatus,
    toStatus: log.toStatus,
    metadata: log.metadata,
    createdAt: formatTimestamp(log.createdAt)!,
  };
}
