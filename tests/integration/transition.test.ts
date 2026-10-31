import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { prisma } from '../../lib/db/prisma';
import { transitionSubscription } from '../../lib/services/subscriptions/transition';
import { parseBusinessDate } from '../../lib/dates/business-date';
import { AppError } from '../../lib/errors';
import Decimal from 'decimal.js';

async function expectErrorCode(fn: Promise<any>, expectedCode: string) {
  try {
    await fn;
    expect.unreachable('Expected promise to reject with AppError');
  } catch (err: any) {
    expect(err.code).toBe(expectedCode);
  }
}

describe('Subscription Transition Lifecycle and Plan Rule Gating', () => {
  const createdSubIds: string[] = [];
  let customerId: string;
  let staffUserId: string;
  let activePlanId: string;
  let inactivePlanId: string;
  let noPausePlanId: string;
  let noEarlyClosePlanId: string;
  let noAutoClosePlanId: string;
  let minQtyPlanId: string;
  let prodId: string;

  beforeAll(async () => {
    const cust = await prisma.customer.upsert({
      where: { email: 'trans-cust@brightloop.demo' },
      update: {},
      create: { name: 'Transition Cust', email: 'trans-cust@brightloop.demo' },
    });
    customerId = cust.id;

    const user = await prisma.user.upsert({
      where: { email: 'trans-staff@brightloop.demo' },
      update: {},
      create: { name: 'Transition Staff', email: 'trans-staff@brightloop.demo', passwordHash: 'dummy', role: 'STAFF' },
    });
    staffUserId = user.id;

    const prod = await prisma.product.upsert({
      where: { id: 'trans_prod_1' },
      update: {},
      create: { id: 'trans_prod_1', name: 'Trans Prod', type: 'SERVICE', salesPrice: new Decimal('100.00'), costPrice: new Decimal('50.00') },
    });
    prodId = prod.id;

    const pActive = await prisma.plan.upsert({
      where: { id: 'plan_trans_active' },
      update: {},
      create: {
        id: 'plan_trans_active',
        name: 'Standard Active',
        billingPeriod: 'MONTHLY',
        availableFrom: parseBusinessDate('2025-01-01'),
        allowPause: true,
        allowEarlyClose: true,
        allowRenewal: true,
        autoCloseOnExpiry: true,
        isActive: true,
      },
    });
    activePlanId = pActive.id;

    const pInactive = await prisma.plan.upsert({
      where: { id: 'plan_trans_inactive' },
      update: {},
      create: {
        id: 'plan_trans_inactive',
        name: 'Inactive Plan',
        billingPeriod: 'MONTHLY',
        availableFrom: parseBusinessDate('2025-01-01'),
        isActive: false,
      },
    });
    inactivePlanId = pInactive.id;

    const pNoPause = await prisma.plan.upsert({
      where: { id: 'plan_trans_nopause' },
      update: {},
      create: {
        id: 'plan_trans_nopause',
        name: 'No Pause Plan',
        billingPeriod: 'MONTHLY',
        availableFrom: parseBusinessDate('2025-01-01'),
        allowPause: false,
        isActive: true,
      },
    });
    noPausePlanId = pNoPause.id;

    const pNoEarly = await prisma.plan.upsert({
      where: { id: 'plan_trans_noearly' },
      update: {},
      create: {
        id: 'plan_trans_noearly',
        name: 'No Early Close Plan',
        billingPeriod: 'MONTHLY',
        availableFrom: parseBusinessDate('2025-01-01'),
        allowEarlyClose: false,
        isActive: true,
      },
    });
    noEarlyClosePlanId = pNoEarly.id;

    const pNoAuto = await prisma.plan.upsert({
      where: { id: 'plan_trans_noauto' },
      update: {},
      create: {
        id: 'plan_trans_noauto',
        name: 'No Auto Close Plan',
        billingPeriod: 'MONTHLY',
        availableFrom: parseBusinessDate('2025-01-01'),
        autoCloseOnExpiry: false,
        allowEarlyClose: false,
        isActive: true,
      },
    });
    noAutoClosePlanId = pNoAuto.id;

    const pMinQty = await prisma.plan.upsert({
      where: { id: 'plan_trans_minqty' },
      update: {},
      create: {
        id: 'plan_trans_minqty',
        name: 'Min Qty 5 Plan',
        billingPeriod: 'MONTHLY',
        minimumQuantity: 5,
        availableFrom: parseBusinessDate('2025-01-01'),
        isActive: true,
      },
    });
    minQtyPlanId = pMinQty.id;
  });

  afterEach(async () => {
    if (createdSubIds.length === 0) return;
    const ids = [...createdSubIds];
    // Cleanup must close every owned subscription. Errors are not swallowed.
    await prisma.subscription.updateMany({
      where: { id: { in: ids } },
      data: { status: 'CLOSED' },
    });
    createdSubIds.length = 0;
  });

  it('runs complete valid lifecycle: DRAFT -> QUOTATION -> CONFIRMED -> ACTIVE -> PAUSED -> RESUME -> CLOSED', async () => {
    // 1. Create DRAFT subscription
    const sub = await prisma.subscription.create({
      data: {
        customerId,
        planId: activePlanId,
        status: 'DRAFT',
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-12-31'),
        paymentTermsDays: 15,
        createdById: staffUserId,
        lines: {
          create: [{ productId: prodId, quantity: 1, unitPrice: new Decimal('100.00') }],
        },
      },
    });
    createdSubIds.push(sub.id);

    // 2. SEND_QUOTATION
    const qRes = await transitionSubscription({
      subscriptionId: sub.id,
      action: 'SEND_QUOTATION',
      actorId: staffUserId,
      todayOverride: parseBusinessDate('2026-01-01'),
    });
    expect(qRes.status).toBe('QUOTATION');

    // 3. CONFIRM_QUOTATION (assigns number)
    const cRes = await transitionSubscription({
      subscriptionId: sub.id,
      action: 'CONFIRM_QUOTATION',
      actorId: staffUserId,
      todayOverride: parseBusinessDate('2026-01-02'),
    });
    expect(cRes.status).toBe('CONFIRMED');
    expect(cRes.number).toMatch(/^SUB-\d{6}$/);

    // 4. ACTIVATE
    const aRes = await transitionSubscription({
      subscriptionId: sub.id,
      action: 'ACTIVATE',
      actorId: staffUserId,
      todayOverride: parseBusinessDate('2026-01-02'),
    });
    expect(aRes.status).toBe('ACTIVE');

    // 5. PAUSE
    const pRes = await transitionSubscription({
      subscriptionId: sub.id,
      action: 'PAUSE',
      actorId: staffUserId,
      todayOverride: parseBusinessDate('2026-02-01'),
    });
    expect(pRes.status).toBe('PAUSED');

    // 6. RESUME
    const rRes = await transitionSubscription({
      subscriptionId: sub.id,
      action: 'RESUME',
      actorId: staffUserId,
      todayOverride: parseBusinessDate('2026-03-15'),
    });
    expect(rRes.status).toBe('ACTIVE');

    // 7. EARLY_CLOSE
    const clRes = await transitionSubscription({
      subscriptionId: sub.id,
      action: 'EARLY_CLOSE',
      actorId: staffUserId,
      closeReason: 'Customer moving',
      todayOverride: parseBusinessDate('2026-04-01'),
    });
    expect(clRes.status).toBe('CLOSED');
  });

  it('rejects invalid transitions with 409 INVALID_TRANSITION', async () => {
    const sub = await prisma.subscription.create({
      data: {
        customerId,
        planId: activePlanId,
        status: 'DRAFT',
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-12-31'),
        paymentTermsDays: 15,
        createdById: staffUserId,
      },
    });
    createdSubIds.push(sub.id);

    await expectErrorCode(
      transitionSubscription({
        subscriptionId: sub.id,
        action: 'ACTIVATE',
        actorId: staffUserId,
      }),
      'INVALID_TRANSITION'
    );

    await expectErrorCode(
      transitionSubscription({
        subscriptionId: sub.id,
        action: 'PAUSE',
        actorId: staffUserId,
      }),
      'INVALID_TRANSITION'
    );
  });

  it('blocks quotation confirmation when plan is inactive or quotation is expired', async () => {
    // Inactive plan
    const subInactive = await prisma.subscription.create({
      data: {
        customerId,
        planId: inactivePlanId,
        status: 'QUOTATION',
        quotationValidUntil: parseBusinessDate('2026-05-01'),
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-12-31'),
        paymentTermsDays: 15,
        createdById: staffUserId,
        lines: {
          create: [{ productId: prodId, quantity: 1, unitPrice: new Decimal('100.00') }],
        },
      },
    });
    createdSubIds.push(subInactive.id);

    await expectErrorCode(
      transitionSubscription({
        subscriptionId: subInactive.id,
        action: 'CONFIRM_QUOTATION',
        actorId: staffUserId,
        todayOverride: parseBusinessDate('2026-01-15'),
      }),
      'PLAN_UNAVAILABLE'
    );

    // Expired quotation
    const subExpiredQuot = await prisma.subscription.create({
      data: {
        customerId,
        planId: activePlanId,
        status: 'QUOTATION',
        quotationValidUntil: parseBusinessDate('2026-01-10'),
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-12-31'),
        paymentTermsDays: 15,
        createdById: staffUserId,
        lines: {
          create: [{ productId: prodId, quantity: 1, unitPrice: new Decimal('100.00') }],
        },
      },
    });
    createdSubIds.push(subExpiredQuot.id);

    await expectErrorCode(
      transitionSubscription({
        subscriptionId: subExpiredQuot.id,
        action: 'CONFIRM_QUOTATION',
        actorId: staffUserId,
        todayOverride: parseBusinessDate('2026-01-15'), // after quotationValidUntil
      }),
      'QUOTATION_EXPIRED'
    );
  });

  it('blocks PAUSE when plan.allowPause is false', async () => {
    const sub = await prisma.subscription.create({
      data: {
        customerId,
        planId: noPausePlanId,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-12-31'),
        paymentTermsDays: 15,
        createdById: staffUserId,
      },
    });
    createdSubIds.push(sub.id);

    await expectErrorCode(
      transitionSubscription({
        subscriptionId: sub.id,
        action: 'PAUSE',
        actorId: staffUserId,
        todayOverride: parseBusinessDate('2026-02-01'),
      }),
      'PLAN_RULE_BLOCKED'
    );
  });

  it('blocks EARLY_CLOSE when plan.allowEarlyClose is false, but allows staff EXPIRY_CLOSE on expiry', async () => {
    const sub = await prisma.subscription.create({
      data: {
        customerId,
        planId: noEarlyClosePlanId,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-06-30'),
        paymentTermsDays: 15,
        createdById: staffUserId,
      },
    });
    createdSubIds.push(sub.id);

    // Before expiry: EARLY_CLOSE blocked
    await expectErrorCode(
      transitionSubscription({
        subscriptionId: sub.id,
        action: 'EARLY_CLOSE',
        actorId: staffUserId,
        todayOverride: parseBusinessDate('2026-03-01'),
      }),
      'PLAN_RULE_BLOCKED'
    );

    // On or after expiry: staff EXPIRY_CLOSE allowed even though allowEarlyClose is false!
    const expRes = await transitionSubscription({
      subscriptionId: sub.id,
      action: 'EXPIRY_CLOSE',
      actorId: staffUserId,
      todayOverride: parseBusinessDate('2026-07-01'),
    });
    expect(expRes.status).toBe('CLOSED');
  });

  it('system expiry closure blocked when autoCloseOnExpiry is false', async () => {
    const sub = await prisma.subscription.create({
      data: {
        customerId,
        planId: noAutoClosePlanId,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        expiryDate: parseBusinessDate('2026-06-30'),
        paymentTermsDays: 15,
        createdById: staffUserId,
      },
    });
    createdSubIds.push(sub.id);

    // System closure (actorId null, billingRunId set)
    await expectErrorCode(
      transitionSubscription({
        subscriptionId: sub.id,
        action: 'EXPIRY_CLOSE',
        actorId: null,
        billingRunId: 'run_123',
        todayOverride: parseBusinessDate('2026-07-01'),
      }),
      'PLAN_RULE_BLOCKED'
    );
  });
});
