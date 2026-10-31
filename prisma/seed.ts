import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { prisma } from '../lib/db/prisma';
import { hashPassword } from '../lib/auth/password';
import { todayBusinessDate, addDays, addUnits, parseBusinessDate } from '../lib/dates/business-date';
import { reserveSubscriptionNumber, reserveInvoiceNumber } from '../lib/services/numbering';
import { calculateInvoiceTotals, RawInvoiceLineInput } from '../lib/calculations/invoice';
import { runBilling } from '../lib/services/billing/run';
import Decimal from 'decimal.js';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed in production environment.');
    process.exit(1);
  }

  const requestedScale = process.env.SEED_SCALE || 'demo';
  const targetVersion = `v1:${requestedScale}`;

  // Check seed version
  const existingVersion = await prisma.systemSetting.findUnique({
    where: { key: 'seed.version' },
  });

  if (existingVersion) {
    if (existingVersion.value === targetVersion) {
      console.log(`already seeded with scale ${requestedScale}`);
      return;
    } else {
      console.error('run npm run db:reset first. Changing scale requires a clean database.');
      process.exit(1);
    }
  }

  // Check partial seed failure
  const [subCount, invCount, userCount] = await Promise.all([
    prisma.subscription.count(),
    prisma.invoice.count(),
    prisma.user.count(),
  ]);

  if (subCount > 0 || invCount > 0 || userCount > 0) {
    console.error('Database is in a partially seeded state. Please run: npm run db:reset');
    process.exit(1);
  }

  console.log(`Seeding database with scale: ${requestedScale}...`);

  const today = todayBusinessDate();
  const demoPasswordHash = await hashPassword('Demo@12345');

  // 1. Reference Data: Taxes
  const tax18 = await prisma.tax.upsert({
    where: { id: 'tax_gst_18' },
    update: {},
    create: {
      id: 'tax_gst_18',
      name: 'GST 18%',
      ratePercent: new Decimal('18.00'),
      isActive: true,
    },
  });

  const tax12 = await prisma.tax.upsert({
    where: { id: 'tax_gst_12' },
    update: {},
    create: {
      id: 'tax_gst_12',
      name: 'GST 12%',
      ratePercent: new Decimal('12.00'),
      isActive: true,
    },
  });

  // 2. Reference Data: Products & Variants
  const prodSuite = await prisma.product.upsert({
    where: { id: 'prod_brightloop_suite' },
    update: {},
    create: {
      id: 'prod_brightloop_suite',
      name: 'Brightloop Business Suite',
      type: 'SERVICE',
      salesPrice: new Decimal('1000.00'),
      costPrice: new Decimal('400.00'),
      notes: 'Flagship enterprise subscription suite',
      defaultTaxId: tax18.id,
      isActive: true,
    },
  });

  const prodAnalytics = await prisma.product.upsert({
    where: { id: 'prod_analytics_addon' },
    update: {},
    create: {
      id: 'prod_analytics_addon',
      name: 'Advanced Analytics Module',
      type: 'SERVICE',
      salesPrice: new Decimal('500.00'),
      costPrice: new Decimal('150.00'),
      defaultTaxId: tax18.id,
      isActive: true,
    },
  });

  const prodStorage = await prisma.product.upsert({
    where: { id: 'prod_cloud_storage' },
    update: {},
    create: {
      id: 'prod_cloud_storage',
      name: 'Cloud Storage 1TB',
      type: 'SERVICE',
      salesPrice: new Decimal('200.00'),
      costPrice: new Decimal('50.00'),
      defaultTaxId: tax12.id,
      isActive: true,
    },
  });

  const prodSupport = await prisma.product.upsert({
    where: { id: 'prod_dedicated_support' },
    update: {},
    create: {
      id: 'prod_dedicated_support',
      name: '24/7 Dedicated Support',
      type: 'SERVICE',
      salesPrice: new Decimal('800.00'),
      costPrice: new Decimal('300.00'),
      defaultTaxId: tax18.id,
      isActive: true,
    },
  });

  // Variants (3 variants, including Brand: Odoo with adjustment 560)
  const variantOdoo = await prisma.productVariant.upsert({
    where: {
      productId_attribute_value: {
        productId: prodSuite.id,
        attribute: 'Brand',
        value: 'Odoo',
      },
    },
    update: {},
    create: {
      id: 'var_suite_odoo',
      productId: prodSuite.id,
      attribute: 'Brand',
      value: 'Odoo',
      priceAdjustment: new Decimal('560.00'), // 1000 + 560 = 1560
      isActive: true,
    },
  });

  await prisma.productVariant.upsert({
    where: {
      productId_attribute_value: {
        productId: prodSuite.id,
        attribute: 'Tier',
        value: 'Enterprise',
      },
    },
    update: {},
    create: {
      id: 'var_suite_enterprise',
      productId: prodSuite.id,
      attribute: 'Tier',
      value: 'Enterprise',
      priceAdjustment: new Decimal('300.00'),
      isActive: true,
    },
  });

  await prisma.productVariant.upsert({
    where: {
      productId_attribute_value: {
        productId: prodAnalytics.id,
        attribute: 'Edition',
        value: 'Pro',
      },
    },
    update: {},
    create: {
      id: 'var_analytics_pro',
      productId: prodAnalytics.id,
      attribute: 'Edition',
      value: 'Pro',
      priceAdjustment: new Decimal('150.00'),
      isActive: true,
    },
  });

  // 3. Plans (4 plans: DAILY, WEEKLY, MONTHLY, YEARLY)
  const planDaily = await prisma.plan.upsert({
    where: { id: 'plan_daily' },
    update: {},
    create: {
      id: 'plan_daily',
      name: 'Daily Flex Plan',
      billingPeriod: 'DAILY',
      billingInterval: 1,
      minimumQuantity: 1,
      availableFrom: addDays(today, -365),
      paymentTermsDays: 7,
      autoCloseOnExpiry: true,
      allowEarlyClose: true,
      allowPause: false,
      allowRenewal: true,
      isActive: true,
    },
  });

  const planWeekly = await prisma.plan.upsert({
    where: { id: 'plan_weekly' },
    update: {},
    create: {
      id: 'plan_weekly',
      name: 'Weekly Growth Plan',
      billingPeriod: 'WEEKLY',
      billingInterval: 1,
      minimumQuantity: 1,
      availableFrom: addDays(today, -365),
      paymentTermsDays: 10,
      autoCloseOnExpiry: true,
      allowEarlyClose: true,
      allowPause: true,
      allowRenewal: true,
      isActive: true,
    },
  });

  const planMonthly = await prisma.plan.upsert({
    where: { id: 'plan_monthly' },
    update: {},
    create: {
      id: 'plan_monthly',
      name: 'Monthly Standard Plan',
      billingPeriod: 'MONTHLY',
      billingInterval: 1,
      minimumQuantity: 1,
      availableFrom: addDays(today, -365),
      paymentTermsDays: 15,
      autoCloseOnExpiry: true,
      allowEarlyClose: false,
      allowPause: true,
      allowRenewal: true,
      isActive: true,
    },
  });

  const planYearly = await prisma.plan.upsert({
    where: { id: 'plan_yearly' },
    update: {},
    create: {
      id: 'plan_yearly',
      name: 'Yearly Enterprise Plan',
      billingPeriod: 'YEARLY',
      billingInterval: 1,
      minimumQuantity: 1,
      availableFrom: addDays(today, -365),
      paymentTermsDays: 30,
      autoCloseOnExpiry: false,
      allowEarlyClose: true,
      allowPause: true,
      allowRenewal: true,
      isActive: true,
    },
  });

  // 4. Quotation Templates (2 templates)
  const templateStandard = await prisma.quotationTemplate.upsert({
    where: { id: 'tmpl_standard' },
    update: {},
    create: {
      id: 'tmpl_standard',
      name: 'Standard Business Bundle',
      planId: planMonthly.id,
      validityDays: 30,
      notes: 'Includes Brightloop Suite and dedicated support.',
      isActive: true,
      lines: {
        create: [
          {
            productId: prodSuite.id,
            variantId: variantOdoo.id,
            quantity: 1,
          },
          {
            productId: prodSupport.id,
            quantity: 1,
          },
        ],
      },
    },
  });

  await prisma.quotationTemplate.upsert({
    where: { id: 'tmpl_starter' },
    update: {},
    create: {
      id: 'tmpl_starter',
      name: 'Starter Cloud Package',
      planId: planMonthly.id,
      validityDays: 15,
      notes: 'Entry-level storage and analytics bundle.',
      isActive: true,
      lines: {
        create: [
          {
            productId: prodStorage.id,
            quantity: 2,
          },
        ],
      },
    },
  });

  // 5. Discounts (2 discounts: 1 FIXED product-scoped maxUses 5, 1 PERCENT subscription-scoped maxUses 1)
  const discFixed = await prisma.discount.upsert({
    where: { id: 'disc_fixed_product' },
    update: {},
    create: {
      id: 'disc_fixed_product',
      name: 'Support Welcome ₹100 Off',
      kind: 'FIXED',
      value: new Decimal('100.00'),
      scope: 'PRODUCT',
      startsOn: addDays(today, -90),
      endsOn: addDays(today, 90),
      maxUses: 5,
      timesUsed: 0,
      isActive: true,
      products: {
        create: [{ productId: prodSupport.id }],
      },
    },
  });

  const discPercent = await prisma.discount.upsert({
    where: { id: 'disc_percent_subscription' },
    update: {},
    create: {
      id: 'disc_percent_subscription',
      name: 'VIP 10% Off Subscription',
      kind: 'PERCENT',
      value: new Decimal('10.00'),
      scope: 'SUBSCRIPTION',
      startsOn: addDays(today, -90),
      endsOn: addDays(today, 90),
      maxUses: 1,
      timesUsed: 0,
      isActive: true,
    },
  });

  // 6. Customers (12 customers, acme@corp.demo has no User account)
  const customerRecords: Array<{ id: string; email: string }> = [];
  for (let i = 1; i <= 12; i++) {
    const isAcme = i === 1;
    const email = isAcme ? 'acme@corp.demo' : `customer${i}@brightloop.demo`;
    const name = isAcme ? 'Acme Corporation' : `Customer Company ${i}`;
    const cust = await prisma.customer.upsert({
      where: { email },
      update: {},
      create: {
        id: `cust_${i}`,
        name,
        email,
        phone: `+91 98765 4321${i % 10}`,
        company: name,
        address: `${100 + i}, Tech Park, Bengaluru, Karnataka, India`,
      },
    });
    customerRecords.push(cust);
  }

  // 7. Users: Demo accounts (local development only)
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@brightloop.demo' },
    update: {},
    create: {
      id: 'user_admin',
      name: 'Admin User',
      email: 'admin@brightloop.demo',
      passwordHash: demoPasswordHash,
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: false,
    },
  });

  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@brightloop.demo' },
    update: {},
    create: {
      id: 'user_staff',
      name: 'Staff Member',
      email: 'staff@brightloop.demo',
      passwordHash: demoPasswordHash,
      role: 'STAFF',
      isActive: true,
      mustChangePassword: false,
    },
  });

  const primaryCustomer = customerRecords[1]; // customer2@brightloop.demo
  const demoCustomerUser = await prisma.user.upsert({
    where: { email: 'customer@brightloop.demo' },
    update: {},
    create: {
      id: 'user_demo_customer',
      name: 'Primary Demo Customer',
      email: 'customer@brightloop.demo',
      passwordHash: demoPasswordHash,
      role: 'CUSTOMER',
      isActive: true,
      mustChangePassword: false,
      customerId: primaryCustomer.id,
    },
  });

  // 8. Subscriptions (15 subscriptions across statuses)
  // Two catch-up demonstration subscriptions:
  // - "Migrated monthly subscription": MONTHLY plan, startDate 3 months before today on anchor
  const migratedMonthlyStart = addUnits(today, 'MONTHLY', 1, -3);
  const migratedMonthly = await prisma.$transaction(async (tx) => {
    const subNum = await reserveSubscriptionNumber(tx);
    return tx.subscription.create({
      data: {
        id: 'sub_migrated_monthly',
        number: subNum,
        customerId: primaryCustomer.id,
        planId: planMonthly.id,
        status: 'ACTIVE',
        startDate: migratedMonthlyStart,
        expiryDate: addUnits(migratedMonthlyStart, 'YEARLY', 1, 2), // Far future
        nextBillingDate: migratedMonthlyStart,
        billingCycleIndex: 0,
        paymentTermsDays: 15,
        createdById: staffUser.id,
        lines: {
          create: [
            {
              productId: prodSuite.id,
              variantId: variantOdoo.id,
              quantity: 1,
              unitPrice: new Decimal('1560.00'),
              taxId: tax18.id,
            },
          ],
        },
      },
    });
  });

  // Assign VIP 10% discount to migrated monthly subscription
  await prisma.subscriptionDiscount.create({
    data: {
      subscriptionId: migratedMonthly.id,
      discountId: discPercent.id,
    },
  });

  // - "Migrated daily subscription": DAILY plan, startDate 14 days before today
  const migratedDailyStart = addDays(today, -14);
  const migratedDaily = await prisma.$transaction(async (tx) => {
    const subNum = await reserveSubscriptionNumber(tx);
    return tx.subscription.create({
      data: {
        id: 'sub_migrated_daily',
        number: subNum,
        customerId: customerRecords[2].id,
        planId: planDaily.id,
        status: 'ACTIVE',
        startDate: migratedDailyStart,
        expiryDate: addDays(migratedDailyStart, 100), // Far future
        nextBillingDate: migratedDailyStart,
        billingCycleIndex: 0,
        paymentTermsDays: 7,
        createdById: staffUser.id,
        lines: {
          create: [
            {
              productId: prodStorage.id,
              quantity: 5,
              unitPrice: new Decimal('200.00'),
              taxId: tax12.id,
            },
          ],
        },
      },
    });
  });

  // Create additional subscriptions (across DRAFT, QUOTATION, CONFIRMED, ACTIVE, PAUSED, CLOSED)
  const otherSubsConfig = [
    { id: 'sub_draft_1', status: 'DRAFT', plan: planMonthly, cust: customerRecords[0], start: today, exp: addUnits(today, 'YEARLY', 1, 1) },
    { id: 'sub_draft_2', status: 'DRAFT', plan: planWeekly, cust: customerRecords[3], start: today, exp: addUnits(today, 'MONTHLY', 1, 6) },
    { id: 'sub_quot_1', status: 'QUOTATION', plan: planMonthly, cust: customerRecords[4], start: today, exp: addUnits(today, 'YEARLY', 1, 1), validUntil: addDays(today, 20) },
    { id: 'sub_quot_2', status: 'QUOTATION', plan: planYearly, cust: customerRecords[5], start: today, exp: addUnits(today, 'YEARLY', 1, 2), validUntil: addDays(today, 25) },
    { id: 'sub_conf_1', status: 'CONFIRMED', plan: planMonthly, cust: customerRecords[6], start: today, exp: addUnits(today, 'YEARLY', 1, 1) },
    { id: 'sub_conf_2', status: 'CONFIRMED', plan: planWeekly, cust: customerRecords[7], start: today, exp: addUnits(today, 'MONTHLY', 1, 3) },
    { id: 'sub_act_1', status: 'ACTIVE', plan: planMonthly, cust: customerRecords[8], start: addUnits(today, 'YEARLY', 1, -1), exp: addUnits(today, 'YEARLY', 1, 1) },
    { id: 'sub_act_2', status: 'ACTIVE', plan: planWeekly, cust: customerRecords[9], start: addDays(today, -60), exp: addUnits(today, 'MONTHLY', 1, 6) },
    { id: 'sub_paused_1', status: 'PAUSED', plan: planMonthly, cust: primaryCustomer, start: addUnits(today, 'MONTHLY', 1, -4), exp: addUnits(today, 'YEARLY', 1, 1), pausedAt: addDays(today, -5) },
    { id: 'sub_paused_2', status: 'PAUSED', plan: planWeekly, cust: customerRecords[10], start: addDays(today, -45), exp: addUnits(today, 'MONTHLY', 1, 6), pausedAt: addDays(today, -3) },
    { id: 'sub_closed_1', status: 'CLOSED', plan: planMonthly, cust: customerRecords[11], start: addUnits(today, 'YEARLY', 1, -1), exp: addDays(today, -10), closedAt: addDays(today, -10), closeReason: 'EXPIRED' },
    { id: 'sub_closed_2', status: 'CLOSED', plan: planMonthly, cust: customerRecords[2], start: addUnits(today, 'MONTHLY', 1, -5), exp: addUnits(today, 'MONTHLY', 1, 7), closedAt: addDays(today, -2), closeReason: 'Customer requested cancellation' },
    { id: 'sub_act_expiring', status: 'ACTIVE', plan: planMonthly, cust: customerRecords[3], start: addUnits(today, 'YEARLY', 1, -1), exp: addDays(today, 15) }, // Upcoming renewal (next 30 days)
  ];

  const createdSubs: { id: string; customerId: string; startDate: Date }[] = [];

  for (const cfg of otherSubsConfig) {
    const sub = await prisma.$transaction(async (tx) => {
      const needsNumber = cfg.status !== 'DRAFT' && cfg.status !== 'QUOTATION';
      const number = needsNumber ? await reserveSubscriptionNumber(tx) : null;
      return tx.subscription.create({
        data: {
          id: cfg.id,
          number,
          customerId: cfg.cust.id,
          planId: cfg.plan.id,
          status: cfg.status,
          startDate: cfg.start,
          expiryDate: cfg.exp,
          nextBillingDate: cfg.status === 'ACTIVE' ? cfg.start : null,
          billingCycleIndex: 0,
          quotationValidUntil: cfg.validUntil || null,
          paymentTermsDays: cfg.plan.paymentTermsDays,
          pausedAt: cfg.pausedAt ? new Date(cfg.pausedAt) : null,
          closedAt: cfg.closedAt ? new Date(cfg.closedAt) : null,
          closeReason: cfg.closeReason || null,
          createdById: staffUser.id,
          lines: {
            create: [
              {
                productId: prodSuite.id,
                quantity: 1,
                unitPrice: new Decimal('1000.00'),
                taxId: tax18.id,
              },
            ],
          },
        },
      });
    });

    createdSubs.push({
      id: sub.id,
      customerId: sub.customerId,
      startDate: sub.startDate,
    });

    // Write audit row with backdated createdAt consistent with dates
    await prisma.auditLog.create({
      data: {
        actorId: staffUser.id,
        action: 'STATUS_CHANGE',
        entityType: 'Subscription',
        entityId: cfg.id,
        fromStatus: null,
        toStatus: cfg.status,
        createdAt: cfg.start,
      },
    });
  }

  // 9. Customer Requests (at least 2 pending: one PAUSE, one RENEW)
  await prisma.subscriptionRequest.create({
    data: {
      id: 'req_pause_demo',
      subscriptionId: 'sub_act_1',
      customerId: customerRecords[8].id,
      requestType: 'PAUSE',
      status: 'PENDING',
      customerNote: 'Temporary freeze during seasonal office relocation.',
    },
  });

  await prisma.subscriptionRequest.create({
    data: {
      id: 'req_renew_demo',
      subscriptionId: 'sub_act_expiring',
      customerId: customerRecords[3].id,
      requestType: 'RENEW',
      status: 'PENDING',
      customerNote: 'Renewing for another billing cycle.',
    },
  });

  // 10. Seed 40 Invoices across statuses with payments & at least 4 overdue
  // Numbers span 2025 and 2026
  console.log('Generating seed invoices and payments...');
  // We attach invoices to the created non-migrated subscriptions
  // Ensure each subscriptionId has distinct periodStart dates
  const subPeriodTracker = new Map<string, number>();

  for (let i = 1; i <= 40; i++) {
    await prisma.$transaction(async (tx) => {
      const year = i <= 20 ? 2025 : 2026;
      const invNum = await reserveInvoiceNumber(tx, year);

      const targetSub = createdSubs[i % createdSubs.length];
      const cycleIndex = subPeriodTracker.get(targetSub.id) || 0;
      subPeriodTracker.set(targetSub.id, cycleIndex + 1);

      const isOverdue = i <= 4;
      const status = isOverdue
        ? 'CONFIRMED'
        : i % 4 === 0
        ? 'PAID'
        : i % 4 === 1
        ? 'CONFIRMED'
        : i % 4 === 2
        ? 'DRAFT'
        : 'CANCELLED';

      // Anchor period starts uniquely per subscription
      const periodStart = addUnits(targetSub.startDate, 'MONTHLY', 1, cycleIndex);
      const periodEnd = addDays(addUnits(targetSub.startDate, 'MONTHLY', 1, cycleIndex + 1), -1);

      // Overdue invoices: dueDate strictly before today (2026-10-31)
      const issueDate = isOverdue
        ? parseBusinessDate('2026-08-01')
        : periodStart;
      const dueDate = isOverdue
        ? parseBusinessDate('2026-08-15')
        : addDays(issueDate, 15);

      const rawLines: RawInvoiceLineInput[] = [
        {
          productId: prodSuite.id,
          variantId: variantOdoo.id,
          description: 'Brightloop Business Suite (Odoo)',
          quantity: 1,
          unitPrice: new Decimal('1560.00'),
          allocatedDiscount: i % 3 === 0 ? new Decimal('100.00') : new Decimal('0.00'),
          taxRatePercent: new Decimal('18.00'),
          taxId: tax18.id,
          sortOrder: 1,
        },
      ];

      const totals = calculateInvoiceTotals(rawLines);
      let amountPaid = new Decimal('0.00');

      if (status === 'PAID') {
        amountPaid = totals.total;
      } else if (status === 'CONFIRMED' && !isOverdue && i % 2 === 0) {
        // Partial payment
        amountPaid = new Decimal('500.00');
      }

      const inv = await tx.invoice.create({
        data: {
          id: `seed_inv_${i}`,
          number: status === 'DRAFT' ? null : invNum,
          subscriptionId: targetSub.id,
          customerId: targetSub.customerId,
          status,
          periodStart,
          periodEnd,
          issueDate,
          dueDate,
          subtotal: totals.subtotal.toString(),
          discountTotal: totals.discountTotal.toString(),
          taxableTotal: totals.taxableTotal.toString(),
          taxTotal: totals.taxTotal.toString(),
          total: totals.total.toString(),
          amountPaid: amountPaid.toString(),
          confirmedAt: status !== 'DRAFT' ? issueDate : null,
          cancelledAt: status === 'CANCELLED' ? addDays(issueDate, 2) : null,
          createdAt: issueDate,
          lines: {
            create: totals.lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice.toString(),
              grossAmount: l.grossAmount.toString(),
              allocatedDiscount: l.allocatedDiscount.toString(),
              taxableAmount: l.taxableAmount.toString(),
              taxId: l.taxId,
              taxRatePercent: l.taxRatePercent.toString(),
              taxAmount: l.taxAmount.toString(),
              sortOrder: l.sortOrder,
            })),
          },
        },
      });

      // Record payments if amountPaid > 0
      if (amountPaid.greaterThan(0)) {
        const methods = ['BANK_TRANSFER', 'CREDIT_CARD', 'UPI', 'CASH', 'CHEQUE'] as const;
        await tx.payment.create({
          data: {
            invoiceId: inv.id,
            amount: amountPaid.toString(),
            method: methods[i % methods.length],
            paidOn: issueDate,
            note: 'Seeded verified payment',
            recordedById: staffUser.id,
            createdAt: issueDate,
          },
        });
      }
    });
  }

  // 11. Historical billing run (7 days ago, excluding migrated subscriptions)
  const historicalRunDate = addDays(today, -7);
  console.log('Executing historical billing run...');
  await runBilling(staffUser.id, {
    runDate: historicalRunDate,
    maxPeriods: 12,
    excludeSubscriptionIds: [migratedMonthly.id, migratedDaily.id],
  });

  // 12. Email Outbox entries (at least 2: one PASSWORD_RESET, one INVOICE_SENT)
  await prisma.emailOutbox.create({
    data: {
      toAddress: 'customer@brightloop.demo',
      subject: 'Password Reset Request',
      body: 'You requested a password reset for Brightloop. Link: http://localhost:3000/reset-password?token=demo_token_123. Simulated delivery: not sent.',
      kind: 'PASSWORD_RESET',
      createdAt: addDays(today, -1),
    },
  });

  await prisma.emailOutbox.create({
    data: {
      toAddress: customerRecords[1].email,
      subject: 'Brightloop Invoice INV-2026-000001',
      body: 'Dear Customer, your invoice is ready. Total: ₹1722.80. Due Date: 2026-11-15. Simulated delivery: not sent.',
      kind: 'INVOICE_SENT',
      createdAt: addDays(today, -2),
    },
  });

  // Final write: system setting seed.version
  await prisma.systemSetting.upsert({
    where: { key: 'seed.version' },
    update: { value: targetVersion },
    create: { key: 'seed.version', value: targetVersion },
  });

  console.log(`Seeding completed successfully with marker: ${targetVersion}`);
}

main()
  .catch((e) => {
    console.error('Seed script encountered error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
