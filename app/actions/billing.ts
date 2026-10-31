'use server';

import { revalidatePath } from 'next/cache';
import { requireStaffSession } from '@/lib/auth/guard';
import { runBilling } from '@/lib/services/billing/run';
import { prisma } from '@/lib/db/prisma';

export async function triggerBillingRunAction(options?: { runDate?: string }) {
  try {
    const session = await requireStaffSession();
    const runDate = options?.runDate ? new Date(options.runDate) : undefined;
    const run = await runBilling(session.userId, { runDate });
    revalidatePath('/billing');
    return { success: true, run };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to execute billing run';
    return { success: false, error: message };
  }
}

export async function getBillingRunDetailsAction(runId: string) {
  try {
    await requireStaffSession();

    const run = await prisma.billingRun.findUnique({
      where: { id: runId },
      include: {
        startedBy: {
          select: { name: true, email: true },
        },
      },
    });

    if (!run) {
      return { success: false, error: 'Billing run not found' };
    }

    const outcomes = await prisma.auditLog.findMany({
      where: {
        billingRunId: runId,
        action: 'BILLING_OUTCOME',
      },
      orderBy: { seq: 'desc' },
    });

    const subscriptionIds = outcomes.map((o) => o.entityId);
    const subscriptions = await prisma.subscription.findMany({
      where: { id: { in: subscriptionIds } },
      include: {
        customer: { select: { name: true, email: true } },
      },
    });

    const subMap = new Map(subscriptions.map((s) => [s.id, s]));

    const details = outcomes.map((o) => {
      const sub = subMap.get(o.entityId);
      const meta = o.metadata as {
        finalOutcome?: string;
        invoicesGenerated?: number;
        reason?: string;
        error?: string;
      } | null;

      return {
        id: o.id,
        subscriptionId: o.entityId,
        subscriptionNumber: sub?.number || o.entityId.slice(0, 8),
        customerName: sub?.customer?.name || 'Unknown',
        customerEmail: sub?.customer?.email || '',
        outcome: meta?.finalOutcome || 'UNKNOWN',
        invoicesGenerated: meta?.invoicesGenerated || 0,
        reason: meta?.reason || meta?.error || null,
        timestamp: o.createdAt,
      };
    });

    return {
      success: true,
      run,
      outcomes: details,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load details';
    return { success: false, error: message };
  }
}
