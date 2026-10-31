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
