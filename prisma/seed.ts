import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { prisma } from '../lib/db/prisma';
import { hashPassword } from '../lib/auth/password';
import { todayBusinessDate, addDays, addUnits } from '../lib/dates/business-date';
import { transitionSubscriptionTx } from '../lib/services/subscriptions/transition';
import { runBilling } from '../lib/services/billing/run';
import { confirmInvoice, cancelInvoice, sendInvoiceToOutbox } from '../lib/services/invoices';
import { recordPayment } from '../lib/services/payments';
import { assignSubscriptionDiscount } from '../lib/services/discounts';
import { createSubscriptionRequest } from '../lib/services/requests';
import { requestPasswordReset } from '../lib/services/auth';
import { createAuditLog } from '../lib/services/audit';
import Decimal from 'decimal.js';

interface SeedSubConfig {
  id: string;
  customerId: string;
  planId: string;
  targetStatus: 'DRAFT' | 'QUOTATION' | 'CONFIRMED' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
  startDate: Date;
  expiryDate?: Date;
  paymentTermsDays?: number;
  quotationValidUntil?: Date;
  lines: Array<{
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitPrice: Decimal;
    taxId?: string | null;
  }>;
  pauseDate?: Date;
  closeDate?: Date;
  closeReason?: string;
}

async function createLifecycleSubscription(
  cfg: SeedSubConfig,
  actorId: string
) {
  return prisma.$transaction(async (tx) => {
    // 1. Create in DRAFT status
    const sub = await tx.subscription.create({
      data: {
        id: cfg.id,
        customerId: cfg.customerId,
        planId: cfg.planId,
        status: 'DRAFT',
        startDate: cfg.startDate,
        expiryDate: cfg.expiryDate || addUnits(cfg.startDate, 'YEARLY', 1, 1),
        paymentTermsDays: cfg.paymentTermsDays ?? 15,
        createdById: actorId,
        createdAt: cfg.startDate,
        lines: {
          create: cfg.lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId || null,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxId: l.taxId || null,
          })),
        },
      },
    });

    await createAuditLog(
      {
        actorId,
        action: 'STATUS_CHANGE',
        entityType: 'Subscription',
        entityId: sub.id,
        fromStatus: null,
        toStatus: 'DRAFT',
        auditAt: cfg.startDate,
      },
      tx
    );

    if (cfg.targetStatus === 'DRAFT') {
      return sub;
    }

    // 2. Transition SEND_QUOTATION -> QUOTATION
    await transitionSubscriptionTx(tx, {
      subscriptionId: sub.id,
      action: 'SEND_QUOTATION',
      actorId,
      asOfDate: cfg.startDate,
      auditAt: cfg.startDate,
    });

    if (cfg.targetStatus === 'QUOTATION') {
      return sub;
    }

    // 3. Transition CONFIRM_QUOTATION -> CONFIRMED (assigns subscription number)
    await transitionSubscriptionTx(tx, {
      subscriptionId: sub.id,
      action: 'CONFIRM_QUOTATION',
      actorId,
      asOfDate: cfg.startDate,
      auditAt: cfg.startDate,
    });

    if (cfg.targetStatus === 'CONFIRMED') {
      return sub;
    }

    // 4. Transition ACTIVATE -> ACTIVE
    await transitionSubscriptionTx(tx, {
      subscriptionId: sub.id,
      action: 'ACTIVATE',
      actorId,
      asOfDate: cfg.startDate,
      auditAt: cfg.startDate,
    });

    if (cfg.targetStatus === 'ACTIVE') {
      return sub;
    }

    // 5. If PAUSED
    if (cfg.targetStatus === 'PAUSED') {
      const pauseDate = cfg.pauseDate || addDays(cfg.startDate, 10);
      await transitionSubscriptionTx(tx, {
        subscriptionId: sub.id,
        action: 'PAUSE',
        actorId,
        asOfDate: pauseDate,
        auditAt: pauseDate,
      });
      return sub;
    }

    // 6. If CLOSED
    if (cfg.targetStatus === 'CLOSED') {
      const closeDate = cfg.closeDate || addDays(cfg.startDate, 20);
      await transitionSubscriptionTx(tx, {
        subscriptionId: sub.id,
        action: 'EARLY_CLOSE',
        actorId,
        asOfDate: closeDate,
        auditAt: closeDate,
        closeReason: cfg.closeReason || 'Customer requested early close',
      });
      return sub;
    }

    return sub;
  });
}

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

  // ==========================================
  // 1. Reference Data: Taxes
  // ==========================================
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

  // ==========================================
  // 2. Reference Data: Products & Variants
  // ==========================================
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

  // Variants (including Brand: Odoo with adjustment 560: 1000 + 560 = 1560)
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
      priceAdjustment: new Decimal('560.00'),
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

  // ==========================================
  // 3. Reference Data: Plans
  // ==========================================
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
      paymentTermsDays: 7,
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

  // ==========================================
  // 4. Quotation Templates
  // ==========================================
  await prisma.quotationTemplate.upsert({
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

  // ==========================================
  // 5. Reference Data: Discounts
  // ==========================================
  await prisma.discount.upsert({
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

  // ==========================================
  // 6. Customers & Users
  // ==========================================
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
  await prisma.user.upsert({
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

  // ==========================================
  // 7. Subscriptions: Real Lifecycle Transitions
  // ==========================================
  console.log('Creating subscriptions through lifecycle transitions...');

  const demoSubsConfig: SeedSubConfig[] = [
    // DRAFT subscriptions
    {
      id: 'sub_draft_1',
      customerId: customerRecords[0].id,
      planId: planMonthly.id,
      targetStatus: 'DRAFT',
      startDate: today,
      lines: [
        { productId: prodSuite.id, variantId: variantOdoo.id, quantity: 1, unitPrice: new Decimal('1560.00'), taxId: tax18.id },
      ],
    },
    {
      id: 'sub_draft_2',
      customerId: customerRecords[3].id,
      planId: planWeekly.id,
      targetStatus: 'DRAFT',
      startDate: today,
      lines: [
        { productId: prodStorage.id, quantity: 2, unitPrice: new Decimal('200.00'), taxId: tax12.id },
      ],
    },

    // QUOTATION subscriptions
    {
      id: 'sub_quot_1',
      customerId: customerRecords[4].id,
      planId: planMonthly.id,
      targetStatus: 'QUOTATION',
      startDate: today,
      lines: [
        { productId: prodSuite.id, quantity: 1, unitPrice: new Decimal('1000.00'), taxId: tax18.id },
      ],
    },
    {
      id: 'sub_quot_2',
      customerId: customerRecords[5].id,
      planId: planYearly.id,
      targetStatus: 'QUOTATION',
      startDate: today,
      lines: [
        { productId: prodStorage.id, quantity: 5, unitPrice: new Decimal('200.00'), taxId: tax12.id },
      ],
    },

    // CONFIRMED subscriptions
    {
      id: 'sub_conf_1',
      customerId: customerRecords[6].id,
      planId: planMonthly.id,
      targetStatus: 'CONFIRMED',
      startDate: today,
      lines: [
        { productId: prodSuite.id, variantId: variantOdoo.id, quantity: 1, unitPrice: new Decimal('1560.00'), taxId: tax18.id },
      ],
    },
    {
      id: 'sub_conf_2',
      customerId: customerRecords[7].id,
      planId: planWeekly.id,
      targetStatus: 'CONFIRMED',
      startDate: today,
      lines: [
        { productId: prodAnalytics.id, quantity: 1, unitPrice: new Decimal('500.00'), taxId: tax18.id },
      ],
    },

    // ACTIVE subscriptions with past start dates so historical runs bill them
    {
      id: 'sub_act_1',
      customerId: customerRecords[8].id,
      planId: planMonthly.id,
      targetStatus: 'ACTIVE',
      startDate: addDays(today, -60),
      lines: [
        { productId: prodSuite.id, variantId: variantOdoo.id, quantity: 1, unitPrice: new Decimal('1560.00'), taxId: tax18.id },
        { productId: prodSupport.id, quantity: 1, unitPrice: new Decimal('800.00'), taxId: tax18.id },
      ],
    },
    {
      id: 'sub_act_2',
      customerId: customerRecords[9].id,
      planId: planWeekly.id,
      targetStatus: 'ACTIVE',
      startDate: addDays(today, -45),
      lines: [
        { productId: prodSuite.id, quantity: 1, unitPrice: new Decimal('1000.00'), taxId: tax18.id },
      ],
    },
    {
      id: 'sub_act_3',
      customerId: customerRecords[10].id,
      planId: planDaily.id,
      targetStatus: 'ACTIVE',
      startDate: addDays(today, -14),
      lines: [
        { productId: prodStorage.id, quantity: 3, unitPrice: new Decimal('200.00'), taxId: tax12.id },
      ],
    },
    {
      id: 'sub_act_expiring',
      customerId: customerRecords[3].id,
      planId: planYearly.id,
      targetStatus: 'ACTIVE',
      startDate: addDays(today, -365),
      expiryDate: addDays(today, 15),
      lines: [
        { productId: prodSuite.id, quantity: 1, unitPrice: new Decimal('1000.00'), taxId: tax18.id },
      ],
    },

    // PAUSED subscription
    {
      id: 'sub_paused_1',
      customerId: primaryCustomer.id,
      planId: planWeekly.id,
      targetStatus: 'PAUSED',
      startDate: addDays(today, -45),
      pauseDate: addDays(today, -5),
      lines: [
        { productId: prodAnalytics.id, quantity: 1, unitPrice: new Decimal('500.00'), taxId: tax18.id },
      ],
    },

    // CLOSED subscriptions
    {
      id: 'sub_closed_1',
      customerId: customerRecords[11].id,
      planId: planWeekly.id,
      targetStatus: 'CLOSED',
      startDate: addDays(today, -60),
      closeDate: addDays(today, -10),
      closeReason: 'Customer requested early close',
      lines: [
        { productId: prodStorage.id, quantity: 1, unitPrice: new Decimal('200.00'), taxId: tax12.id },
      ],
    },
    {
      id: 'sub_closed_2',
      customerId: customerRecords[2].id,
      planId: planYearly.id,
      targetStatus: 'CLOSED',
      startDate: addDays(today, -150),
      closeDate: addDays(today, -2),
      closeReason: 'Corporate restructuring',
      lines: [
        { productId: prodSuite.id, quantity: 1, unitPrice: new Decimal('1000.00'), taxId: tax18.id },
      ],
    },
  ];

  for (const cfg of demoSubsConfig) {
    await createLifecycleSubscription(cfg, staffUser.id);
  }

  // ==========================================
  // 8. Assign SUBSCRIPTION-scoped Discount
  // ==========================================
  console.log('Assigning subscription discount...');
  await assignSubscriptionDiscount(
    'sub_act_1',
    discPercent.id,
    staffUser.id,
    addDays(today, -60)
  );

  // ==========================================
  // 9. Historical Billing Runs (-60, -30, -7 days)
  // ==========================================
  console.log('Executing historical billing runs...');
  await runBilling(staffUser.id, {
    asOfDate: addDays(today, -60),
    auditAt: addDays(today, -60),
  });

  await runBilling(staffUser.id, {
    asOfDate: addDays(today, -30),
    auditAt: addDays(today, -30),
  });

  await runBilling(staffUser.id, {
    asOfDate: addDays(today, -7),
    auditAt: addDays(today, -7),
  });

  // ==========================================
  // 10. Confirm a subset of Generated Invoices
  // ==========================================
  console.log('Confirming subset of historical invoices...');
  const allDraftInvoices = await prisma.invoice.findMany({
    where: { status: 'DRAFT' },
    orderBy: { issueDate: 'asc' },
  });

  // Confirm the first 7 invoices; leave remaining as DRAFT
  const invoicesToConfirm = allDraftInvoices.slice(0, 7);
  for (const inv of invoicesToConfirm) {
    await confirmInvoice(inv.id, staffUser.id, {
      asOfDate: inv.issueDate,
      auditAt: inv.issueDate,
    });
  }

  // ==========================================
  // 11. Payments via recordPayment Service
  // ==========================================
  console.log('Recording payments across PAYMENT_METHODS...');
  const confirmedInvoices = await prisma.invoice.findMany({
    where: { status: 'CONFIRMED' },
    orderBy: { issueDate: 'asc' },
  });

  // 1. Partial payment with BANK_TRANSFER
  await recordPayment({
    invoiceId: confirmedInvoices[0].id,
    amount: '200.00',
    method: 'BANK_TRANSFER',
    paidOn: confirmedInvoices[0].issueDate,
    note: 'Initial bank transfer',
    recordedById: staffUser.id,
    asOfDate: confirmedInvoices[0].issueDate,
    auditAt: confirmedInvoices[0].issueDate,
  });

  // 2. Partial payment with UPI
  await recordPayment({
    invoiceId: confirmedInvoices[1].id,
    amount: '300.00',
    method: 'UPI',
    paidOn: confirmedInvoices[1].issueDate,
    note: 'UPI QR scan partial payment',
    recordedById: staffUser.id,
    asOfDate: confirmedInvoices[1].issueDate,
    auditAt: confirmedInvoices[1].issueDate,
  });

  // 3. Cheque payment (partial/advance)
  await recordPayment({
    invoiceId: confirmedInvoices[4].id,
    amount: '150.00',
    method: 'CHEQUE',
    paidOn: confirmedInvoices[4].issueDate,
    note: 'Cheque deposit verified',
    recordedById: staffUser.id,
    asOfDate: confirmedInvoices[4].issueDate,
    auditAt: confirmedInvoices[4].issueDate,
  });

  // 4. Full payment with CASH -> sets invoice status to PAID
  await recordPayment({
    invoiceId: confirmedInvoices[5].id,
    amount: confirmedInvoices[5].total.toString(),
    method: 'CASH',
    paidOn: confirmedInvoices[5].issueDate,
    note: 'Full payment received in cash',
    recordedById: staffUser.id,
    asOfDate: confirmedInvoices[5].issueDate,
    auditAt: confirmedInvoices[5].issueDate,
  });

  // Invoices confirmedInvoices[0], [1], [2], [3], [4] all have dueDate < CURRENT_DATE
  // and positive remaining balance (total - amountPaid > 0), fulfilling the overdue check >= 4!

  // ==========================================
  // 12. Cancel One Confirmed Invoice (Discount Release)
  // ==========================================
  console.log('Cancelling confirmed invoice to test discount usage release...');
  // Find an invoice that received the discount or cancel confirmedInvoices[6]
  const invoiceWithDiscount = await prisma.invoice.findFirst({
    where: {
      status: 'CONFIRMED',
      amountPaid: new Decimal(0),
      discounts: { some: {} },
    },
  });

  const invoiceToCancel = invoiceWithDiscount || confirmedInvoices[6];
  await cancelInvoice(
    invoiceToCancel.id,
    staffUser.id,
    'Customer cancelled prior to payment',
    { asOfDate: invoiceToCancel.issueDate, auditAt: invoiceToCancel.issueDate }
  );

  // ==========================================
  // 13. Migrated Subscriptions (Created after historical runs)
  // ==========================================
  console.log('Creating migrated subscriptions...');
  // MONTHLY subscription starting 3 months before today
  const migratedMonthlyStart = addUnits(today, 'MONTHLY', 1, -3);
  const migratedMonthly = await createLifecycleSubscription(
    {
      id: 'sub_migrated_monthly',
      customerId: primaryCustomer.id,
      planId: planMonthly.id,
      targetStatus: 'ACTIVE',
      startDate: migratedMonthlyStart,
      expiryDate: addUnits(migratedMonthlyStart, 'YEARLY', 1, 2),
      paymentTermsDays: 15,
      lines: [
        { productId: prodSuite.id, variantId: variantOdoo.id, quantity: 1, unitPrice: new Decimal('1560.00'), taxId: tax18.id },
      ],
    },
    staffUser.id
  );

  // Re-assign VIP 10% discount to migrated monthly subscription
  await assignSubscriptionDiscount(
    migratedMonthly.id,
    discPercent.id,
    staffUser.id,
    today
  );

  // DAILY subscription starting 15 days before today (12 cap + 3 pending = 15 total due)
  const migratedDailyStart = addDays(today, -15);
  await createLifecycleSubscription(
    {
      id: 'sub_migrated_daily',
      customerId: customerRecords[2].id,
      planId: planDaily.id,
      targetStatus: 'ACTIVE',
      startDate: migratedDailyStart,
      expiryDate: addDays(migratedDailyStart, 100),
      paymentTermsDays: 7,
      lines: [
        { productId: prodStorage.id, quantity: 5, unitPrice: new Decimal('200.00'), taxId: tax12.id },
      ],
    },
    staffUser.id
  );

  // ==========================================
  // 14. Customer Requests (PAUSE & RENEW)
  // ==========================================
  console.log('Creating customer requests...');
  await createSubscriptionRequest(
    customerRecords[8].id,
    'sub_act_1',
    'PAUSE',
    'Temporary pause during seasonal office relocation.'
  );

  await createSubscriptionRequest(
    customerRecords[3].id,
    'sub_act_expiring',
    'RENEW',
    'Renewing for another annual cycle.'
  );

  // ==========================================
  // 15. Email Outbox via Real Services
  // ==========================================
  console.log('Creating email outbox entries...');
  // Real password reset request
  await requestPasswordReset('customer@brightloop.demo');

  // Real invoice email send
  await sendInvoiceToOutbox(confirmedInvoices[0].id, staffUser.id);

  // ==========================================
  // 16. Load Scale Branch (SEED_SCALE=load)
  // ==========================================
  if (requestedScale === 'load') {
    console.log('Generating 2,000 subscriptions for load scale in chunks of 200...');
    const totalLoadSubs = 2000;
    const chunkSize = 200;
    const numChunks = totalLoadSubs / chunkSize;

    for (let c = 0; c < numChunks; c++) {
      const chunkStart = c * chunkSize + 1;
      const chunkEnd = (c + 1) * chunkSize;

      for (let i = chunkStart; i <= chunkEnd; i++) {
        const cust = customerRecords[(i - 1) % customerRecords.length];
        const startDate = i <= 1000 ? addDays(today, -30) : addDays(today, -1);

        await createLifecycleSubscription(
          {
            id: `sub_load_${i}`,
            customerId: cust.id,
            planId: planMonthly.id,
            targetStatus: 'ACTIVE',
            startDate,
            expiryDate: addUnits(today, 'YEARLY', 1, 1),
            paymentTermsDays: 15,
            lines: [
              { productId: prodSuite.id, quantity: 1, unitPrice: new Decimal('1000.00'), taxId: tax18.id },
            ],
          },
          staffUser.id
        );
      }
      console.log(`Load: chunk ${c + 1}/${numChunks} (${chunkEnd}/${totalLoadSubs} subscriptions created)...`);
    }

    console.log('Load: running historical billing pass at today - 30...');
    await runBilling(staffUser.id, {
      asOfDate: addDays(today, -30),
      auditAt: addDays(today, -30),
    });

    console.log('Load: running historical billing pass at today - 1...');
    await runBilling(staffUser.id, {
      asOfDate: addDays(today, -1),
      auditAt: addDays(today, -1),
    });
  }

  // ==========================================
  // 17. Final Marker: seed.version
  // ==========================================
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
