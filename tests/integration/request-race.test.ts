import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/db/prisma';
import { createSubscriptionRequest, reviewSubscriptionRequest } from '../../lib/services/requests';
import { parseBusinessDate } from '../../lib/dates/business-date';
import Decimal from 'decimal.js';

describe('B5: Request Race & Concurrency (Integration)', () => {
  let customerId: string;
  let staffUserId: string;
  let subId1: string;
  let subId2: string;
  const createdSubIds: string[] = [];

  beforeAll(async () => {
    const cust = await prisma.customer.create({
      data: { name: 'B5 Customer', email: 'b5-cust@brightloop.demo' },
    });
    customerId = cust.id;

    const user = await prisma.user.create({
      data: { name: 'B5 Staff', email: 'b5-staff@brightloop.demo', passwordHash: 'dummy', role: 'STAFF' },
    });
    staffUserId = user.id;

    const plan = await prisma.plan.create({
      data: {
        name: 'B5 Plan',
        billingPeriod: 'MONTHLY',
        availableFrom: parseBusinessDate('2025-01-01'),
        allowPause: true,
        allowEarlyClose: true,
        allowRenewal: true,
        isActive: true,
      },
    });

    const sub1 = await prisma.subscription.create({
      data: {
        customerId,
        planId: plan.id,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-12-31'),
        paymentTermsDays: 15,
        createdById: staffUserId,
      },
    });
    createdSubIds.push(sub1.id);
    subId1 = sub1.id;

    const sub2 = await prisma.subscription.create({
      data: {
        customerId,
        planId: plan.id,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-12-31'),
        paymentTermsDays: 15,
        createdById: staffUserId,
      },
    });
    createdSubIds.push(sub2.id);
    subId2 = sub2.id;
  });

  afterAll(async () => {
    if (createdSubIds.length === 0) return;
    if (!createdSubIds.includes(subId1) || !createdSubIds.includes(subId2)) {
      throw new Error(`Expected createdSubIds to contain both sub1 (${subId1}) and sub2 (${subId2})`);
    }
    const ids = [...createdSubIds];
    const res = await prisma.subscription.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'CLOSED',
        closeReason: 'TEST_CLEANUP',
        closedAt: new Date(),
      },
    });
    if (res.count !== ids.length) {
      throw new Error(`Expected ${ids.length} subscriptions cleaned up in request-race afterAll, but updated ${res.count}`);
    }
    console.log(`[request-race afterAll] closed ${ids.length} registered IDs: ${ids.join(', ')}; update count ${res.count}`);
    createdSubIds.length = 0;
  });

  it('B5 part 1: two concurrent creations of the same request type produce one success and one REQUEST_ALREADY_PENDING', async () => {
    const p1 = createSubscriptionRequest(customerId, subId1, 'PAUSE', 'Pause request 1');
    const p2 = createSubscriptionRequest(customerId, subId1, 'PAUSE', 'Pause request 2');

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const err = rejected[0].reason;
    expect(err?.code).toBe('REQUEST_ALREADY_PENDING');

    const pendingCount = await prisma.subscriptionRequest.count({
      where: { subscriptionId: subId1, status: 'PENDING' },
    });
    expect(pendingCount).toBe(1);
  });

  it('B5 part 2: two concurrent approvals of the same request execute transition once, and audit log shows one transition', async () => {
    // Create a single pause request on subId2
    const req = await createSubscriptionRequest(customerId, subId2, 'PAUSE', 'Single pause request');

    // Two concurrent approvals
    const p1 = reviewSubscriptionRequest(staffUserId, req.id, 'APPROVE');
    const p2 = reviewSubscriptionRequest(staffUserId, req.id, 'APPROVE');

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify subscription status is PAUSED
    const sub = await prisma.subscription.findUnique({ where: { id: subId2 } });
    expect(sub?.status).toBe('PAUSED');

    // Verify audit log has exactly one transition for this subscription
    const transitionLogs = await prisma.auditLog.findMany({
      where: {
        entityType: 'Subscription',
        entityId: subId2,
        action: 'PAUSE',
      },
    });
    expect(transitionLogs.length).toBe(1);
  });
});
