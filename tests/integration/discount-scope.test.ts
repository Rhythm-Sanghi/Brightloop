import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/db/prisma';
import { createDiscount, updateDiscount, assignSubscriptionDiscount, removeSubscriptionDiscount } from '../../lib/services/discounts';
import { parseBusinessDate } from '../../lib/dates/business-date';
import Decimal from 'decimal.js';

describe('Discount Scope Change Protection (Integration)', () => {
  let prodId: string;
  let subId: string;

  beforeAll(async () => {
    // Reference tax & product
    const tax = await prisma.tax.create({
      data: { name: 'Scope Tax', ratePercent: new Decimal('18.00') },
    });
    const prod = await prisma.product.create({
      data: {
        name: 'Scope Test Product',
        type: 'SERVICE',
        salesPrice: new Decimal('1000.00'),
        costPrice: new Decimal('500.00'),
        defaultTaxId: tax.id,
      },
    });
    prodId = prod.id;

    const cust = await prisma.customer.create({
      data: { name: 'Scope Customer', email: 'scope-test@brightloop.demo' },
    });
    const plan = await prisma.plan.create({
      data: {
        name: 'Scope Plan',
        billingPeriod: 'MONTHLY',
        availableFrom: parseBusinessDate('2026-01-01'),
      },
    });
    const user = await prisma.user.create({
      data: {
        name: 'Scope Creator',
        email: 'creator@brightloop.demo',
        passwordHash: 'dummy',
        role: 'STAFF',
      },
    });
    const sub = await prisma.subscription.create({
      data: {
        customerId: cust.id,
        planId: plan.id,
        status: 'ACTIVE',
        startDate: parseBusinessDate('2026-01-01'),
        paymentTermsDays: 15,
        createdById: user.id,
      },
    });
    subId = sub.id;
  });

  it('rejects changing PRODUCT to SUBSCRIPTION while product links exist', async () => {
    const disc = await createDiscount({
      name: 'Product Disc with Links',
      kind: 'FIXED',
      value: '50.00',
      scope: 'PRODUCT',
      startsOn: parseBusinessDate('2026-01-01'),
      productIds: [prodId],
    });

    await expect(
      updateDiscount({
        id: disc.id,
        scope: 'SUBSCRIPTION',
      })
    ).rejects.toThrow(/Cannot change scope from PRODUCT to SUBSCRIPTION while product links exist/);

    // Remove product link
    await prisma.discountProduct.deleteMany({ where: { discountId: disc.id } });

    // Now change succeeds
    const updated = await updateDiscount({
      id: disc.id,
      scope: 'SUBSCRIPTION',
    });
    expect(updated.scope).toBe('SUBSCRIPTION');
  });

  it('rejects changing SUBSCRIPTION to PRODUCT while subscription assignments exist', async () => {
    const disc = await createDiscount({
      name: 'Sub Disc with Assignments',
      kind: 'PERCENT',
      value: '15.00',
      scope: 'SUBSCRIPTION',
      startsOn: parseBusinessDate('2026-01-01'),
    });

    // Assign to subscription
    await assignSubscriptionDiscount(subId, disc.id);

    await expect(
      updateDiscount({
        id: disc.id,
        scope: 'PRODUCT',
      })
    ).rejects.toThrow(/Cannot change scope from SUBSCRIPTION to PRODUCT while subscription assignments exist/);

    // Remove assignment
    await removeSubscriptionDiscount(subId, disc.id);

    // Now change succeeds
    const updated = await updateDiscount({
      id: disc.id,
      scope: 'PRODUCT',
    });
    expect(updated.scope).toBe('PRODUCT');
  });
});
