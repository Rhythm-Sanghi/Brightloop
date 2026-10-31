# Brightloop Subscription Management Platform

> **MASTER EXECUTION SPECIFICATION v5.2**  
> Complete subscription lifecycle, billing engine, discount allocation, GST tax computation, invoice generation, partial payments, customer self-service portal, and financial audit reports.

---

## 1. Technology Stack & Versions

- **Node.js**: `24.15.0 LTS`
- **Next.js**: `16.4.3` (App Router, Turbopack, TypeScript strict)
- **Database**: PostgreSQL 16 (in Docker container `brightloop-db`)
- **ORM**: Prisma `6.19.3` pinned
- **Styling**: Tailwind CSS `4.3.3` + Base UI / shadcn design tokens
- **Auth & Sessions**: `bcryptjs` (cost 12), `jose` (HS256 JWT, 8-hour expiry, httpOnly cookie)
- **Financial Precision**: `decimal.js` for all monetary computations (`ROUND_HALF_UP`)
- **Testing**: `vitest` with separated unit (`npm test`) and integration (`npm run test:integration`) suites

---

## 2. Architecture & Non-Negotiables Verification (B1 – B14)

All 10 non-negotiables are enforced and covered by passing blocking tests:

| Code | Non-Negotiable Requirement | Blocking Test | Status |
|------|----------------------------|---------------|--------|
| **N1** | Exactly 1 invoice per period per subscription; catches up due periods up to cap; zero duplicates under concurrency | **B1, B2, B9, B13** | ✅ PASS |
| **N2** | Payments cannot exceed outstanding balance, including concurrent attempts | **B3** | ✅ PASS |
| **N3** | Discounts computed before tax; maximum uses strictly enforced under concurrency | **B6, Unit Tests** | ✅ PASS |
| **N4** | Sequential invoice numbering per calendar year (`INV-YYYY-XXXXXX`) under concurrent confirmation | **B4, B10** | ✅ PASS |
| **N5** | Historical invoices immutable when product prices or tax rates change | **B8** | ✅ PASS |
| **N6** | Server-enforced customer isolation (returns 404 `NOT_FOUND` on unowned resources) | **B7** | ✅ PASS |
| **N7** | Single subscription transition function with status validation and audit logging | **B5, Unit Tests** | ✅ PASS |
| **N8** | Dashboard KPIs and reports reconcile with direct SQL aggregations | **N8 Reconciliation** | ✅ PASS |
| **N9** | Single-use password reset tokens under concurrency; revokes existing sessions | **B11** | ✅ PASS |
| **N10** | Billing run reports pending work if cap or locks prevent processing | **B12, B14** | ✅ PASS |

---

## 3. Environment & Database Configuration

### 3.1 Port Mapping Rationale
Host port `5432` was occupied by existing host Windows PostgreSQL services. Per Section 5.1 of the specification, the Docker container port was mapped to `5435:5432` in `compose.yaml`:
- **Development Database**: `postgresql://postgres:postgres@localhost:5435/brightloop_db?schema=public`
- **Test Database**: `postgresql://postgres:postgres@localhost:5435/brightloop_test?schema=public`

### 3.2 Quick Setup

```powershell
# 1. Start Docker PostgreSQL container
docker compose up -d

# 2. Initialize test database
docker exec brightloop-db psql -U postgres -c "CREATE DATABASE brightloop_test;"

# 3. Apply database migrations
npx prisma migrate deploy

# 4. Seed demo dataset
npx prisma db seed

# 5. Run unit & integration test suites
npm test
npm run test:integration

# 6. Start development server
npm run dev
```

---

## 4. Role Permissions Matrix

| Resource / Capability | ADMIN | STAFF | CUSTOMER |
|-----------------------|:-----:|:-----:|:--------:|
| Staff Account Creation & Revocation | ✅ | ❌ | ❌ |
| Products, Variants, Plans, Taxes, Templates | ✅ | ✅ | ❌ |
| Create Quotations & Subscriptions | ✅ | ✅ | ❌ |
| Transition Subscriptions (Activate, Close) | ✅ | ✅ | ❌ |
| Assign / Remove Subscription Discounts | ✅ | ❌ | ❌ |
| Review Customer Requests (Approve, Reject) | ✅ | ✅ | ❌ |
| Execute Recurring Billing Run | ✅ | ✅ | ❌ |
| Confirm Invoices & Record Payments | ✅ | ✅ | ❌ |
| View Financial Reports & Export CSV | ✅ | ✅ | ❌ |
| View Own Subscriptions, Invoices, Payments | ❌ | ❌ | ✅ |
| Submit Self-Service Requests (Pause, Renew, Close) | ❌ | ❌ | ✅ |
| Simulated Outbox Inspection | ✅ | ✅ | ❌ |

---

## 5. Simulated Delivery Notice

> **IMPORTANT**: In accordance with Section 2 and Section 13.1 of the specification, real email delivery and third-party payment gateways are explicitly out of scope.
> 
> Password reset emails and invoice notifications are queued in the application database and viewable at `/outbox`. No external emails are dispatched.

---

## 6. Seed Accounts & Walkthrough Guide (Section 23)

### Demo Accounts (Password: `Demo@12345`)
- **Admin**: `admin@brightloop.demo`
- **Staff**: `staff@brightloop.demo`
- **Customer**: `customer@brightloop.demo`

### Walkthrough Verification Steps
1. **Admin Login**: Sign in as `admin@brightloop.demo`.
2. **Staff Provisioning**: Visit `/staff` and create a staff user (e.g. `neha@brightloop.demo`).
3. **Staff First Login**: Log in as `neha@brightloop.demo` with temporary password; prompted to set new password.
4. **Customer Registration**: Register a new customer via `/register` (e.g. `rajesh@acmecorp.demo`).
5. **Catalog Inspection**: Browse `/products` (Standard Product with Odoo variant `+560`), `/plans`, `/taxes` (18% GST), and `/discounts`.
6. **Quotation & Activation**: Create quotation at `/subscriptions` and transition to `ACTIVE`.
7. **Customer Portal**: Sign in as `customer@brightloop.demo` at `/portal/overview`, view `/portal/subscriptions`.
8. **Customer Request**: Submit a Pause or Renewal request from subscription details.
9. **Staff Approval**: Staff reviews pending request at `/requests` and approves it.
10. **Billing Execution**: Navigate to `/billing`, trigger "Run Billing". Review generated draft invoices and catch-up count.
11. **Invoice & Payment**: Confirm invoice at `/invoices/[id]` (`INV-2026-000001`), record partial payment of ₹500, check remaining balance.
12. **Outbox**: Click "Send to Customer" on invoice; verify queued record in `/outbox`.
13. **Reports Reconciliation**: Visit `/reports` and verify that totals match `/dashboard` and direct SQL queries. Download sanitized CSV report.

---

## 7. Technical Decisions & Debt List

1. **Host Port 5435**: Mapped Docker container port `5432` to host `5435` because local PostgreSQL 17/18 instances were active on Windows host port 5432.
2. **Double-quoted SQL Identifiers**: PostgreSQL treats unquoted table names as lowercase; all raw Prisma queries strictly use double quotes (`"Subscription"`, `"Invoice"`, etc.).
3. **CSV Formula Injection Sanitization**: Prepended dangerous starting characters (`=`, `+`, `-`, `@`) with a single quote `'` in CSV exports to protect against spreadsheet formula execution.
4. **Base UI / Radix Slot Compatibility**: Added `asChild` prop support to `Button`, `DialogTrigger`, and `DialogClose` to seamlessly support declarative child components while maintaining full TypeScript compatibility.
5. **Remediation Decision RD1 (PAUSED Gap & Four-Field Pending Breakdown)**:
   - **Spec §10.2 / §0 Gap**: Spec §10.2 requires `status = 'ACTIVE'` for billing run eligibility and auto-closure. Paused subscriptions cannot be billed and cannot be auto-closed during a billing run. They are excluded from all billing categories and from pending counts.
   - **Four-Field Contract**: The finalized `BILLING_RUN_SUMMARY` audit event records:
     - `subscriptionsAwaitingInvoiceGeneration` (Category 1): ACTIVE subscriptions with `remainingBillablePeriods > 0` (including expired subscriptions whose periods start on or before `expiryDate`).
     - `subscriptionsAwaitingExpiryClosure` (Category 2): ACTIVE subscriptions with `expiryDate <= runDate`, `autoCloseOnExpiry = true`, and `remainingBillablePeriods = 0`.
     - `subscriptionsAwaitingManualExpiryClosure` (Category 3): ACTIVE subscriptions with `expiryDate <= runDate`, `autoCloseOnExpiry = false`, and `remainingBillablePeriods = 0`.
     - `subscriptionsPending`: `Category 1 + Category 2`.
   - **Persistence & Exclusions**: `BillingRun.subscriptionsPending` stores `subscriptionsPending`. Category 3 is excluded from `subscriptionsPending`. An ACTIVE subscription with zero remaining periods whose expiry date is in the future or unset is not pending and is placed in no category. On `runDate == expiryDate`, a period starting that day is billable and categorized as Category 1.
6. **Remediation Decision RD2 (Pending Breakdown Storage)**: Stored the pending breakdown in the `BILLING_RUN_SUMMARY` audit log metadata (`subscriptionsAwaitingInvoiceGeneration`, `subscriptionsAwaitingExpiryClosure`, `subscriptionsAwaitingManualExpiryClosure`, `subscriptionsPending`). The billing UI reads Category 3 directly from this finalized event.
7. **Remediation Decision RD3 (Supersession of Spec §10.4 Attempt Counting)**: Spec §10.4 specifies that any attempt (invoice generation or repair) increments the attempt counter toward maxPeriods. In production, a subscription with historical gaps could consume its entire cap on repairs without generating any invoices, leaving the customer unbilled. The implementation supersedes this: the cap counts generated invoices only; repairs are bounded separately at 3 per subscription per run (RD4).
8. **Remediation Decision RD4 (Supersession of Spec §10.5 Repair Bounding)**: Spec §10.5 describes duplicate repair without bounding the number of repairs per run. The implementation supersedes this: repairs are bounded at 3 per subscription per run. A fourth duplicate in a single run indicates data corruption, aborts processing for that subscription with `REPAIR_LIMIT_EXCEEDED`, and marks the subscription `FAILED`.
9. **Remediation Decision RD5 (Invoice Total Invariant Check Timing)**: Invariant check timing evaluates `totals.subtotal.minus(totals.discountTotal).equals(totals.taxableTotal)` and `totals.taxableTotal.plus(totals.taxTotal).equals(totals.total)` after all line discount and GST tax arithmetic is completed, immediately prior to executing the `Invoice` and `InvoiceLine` database insertions within the transaction.
10. **Remediation Decision RD6 (Audit Ordering & Database Default)**:
    - **Supersession of Spec §6.1 / §16.1 Global Chronology Claims**: `AuditLog.seq` is an autoincrement sequence. Sequence allocation is non-transactional; therefore, global `seq` order does not guarantee global commit chronology. For a single entity, `seq` order is exact and deterministic only where every writer holds that entity's row lock through its audit write inside the transaction.
    - **Failure Audit Limitation**: Failure audit rows written after a rolled-back transaction run outside the entity row lock; serialized ordering does not apply to failure events written post-rollback.
    - **Database Default**: Uses PostgreSQL `clock_timestamp()` default for `AuditLog.createdAt`, with queries explicitly ordering by `seq` for deterministic ordering.
11. **Remediation Decision RD7 (Structured P2002 Target Checking)**: Checks both array targets (`['subscriptionId', 'periodStart']`) and constraint name strings (`'Invoice_subscriptionId_periodStart_key'`) to reliably distinguish same-period unique collisions from unrelated unique constraint violations.
12. **Remediation Decision RD8 (In-Transaction Sequential Discount Allocation & Ledger Release)**:
    - Allocates candidate discounts inside the invoice interactive transaction sequentially (`createdAt ASC, id ASC`). Line discount reductions are applied to invoice lines only after a successful conditional usage increment (`UPDATE "Discount" SET "timesUsed" = "timesUsed" + 1 WHERE "id" = ... AND ("maxUses" IS NULL OR "timesUsed" < "maxUses")`) succeeds within the same transaction.
    - On invoice cancellation, releases usage per `InvoiceDiscount` row using `UPDATE "Discount" SET "timesUsed" = "timesUsed" - 1 WHERE "id" = $id AND "timesUsed" > 0`. If affected rows is 0, cancellation fails with `DATA_INCONSISTENT` and rolls back the transaction.
13. **Remediation Decision RD9 (Unified Fault Injection Mechanism)**: Reuses and extends the existing test fault-injection mechanism (`BillingTestOptions` in `lib/services/billing/period.ts`) with typed hooks (`throwAtPeriodIndex`, `throwAfterDiscountIncrement`, `allowRepair`, `onTryIncrementReady`) rather than creating a separate mechanism.
14. **Seed Count Discrepancy Note**: Spec §19.3 specifies a demo seed of 40 invoices across DRAFT, CONFIRMED, PAID, and CANCELLED statuses, with at least 4 overdue. The baseline `prisma/seed.ts` contained a manual loop creating 40 invoices directly via `prisma.invoice.create`. When the seed was rewritten to generate invoices dynamically through `runBilling` to preserve business engine invariants, it generated 17 invoices from the configured active subscriptions. The seed is not artificially padded, preserving financial integrity.
