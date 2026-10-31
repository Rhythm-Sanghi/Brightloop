# Brightloop Subscription Management Platform

A subscription lifecycle, billing, and invoicing platform built as a hackathon project. It covers products and variants, plans, quotations, subscriptions, catch-up billing runs, discounts, GST invoices, partial payments, a customer self-service portal, and financial reports.

> **Status: work in progress.** The core billing engine and its concurrency tests are implemented. Several items are open, including load-scale performance and the demo walkthrough. See [Status](#status) before relying on any claim in this document.

---

## Email is simulated

Real email delivery is out of scope. Password reset messages and invoice notifications are stored as rows in the `EmailOutbox` table and shown on the admin **Outbox** page, labelled "Simulated delivery: not sent." No email is sent to any address. To get a reset link during development, log in as the admin and open `/outbox`.

Real payment gateways are also out of scope. Payments are recorded manually by staff.

---

## Prerequisites

- Windows 11 with PowerShell
- Node.js 22 LTS (check with `node -v`)
- Docker Desktop with the WSL 2 backend (check with `docker compose version`)

If PowerShell blocks npm scripts, run once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## Setup

Run these commands from the project root, in this order.

```powershell
# 1. Start PostgreSQL 16 in Docker (host port 5435 -> container 5432)
docker compose up -d

# 2. Create the environment file, then check it
Copy-Item .env.example .env
```

Open `.env` and confirm that `DATABASE_URL` and `DATABASE_URL_TEST` use port **5435**. The port must match `compose.yaml`. Do not commit `.env`.

```powershell
# 3. Install dependencies
npm install

# 4. Apply migrations and seed the demo data
npx prisma migrate deploy
npx prisma db seed

# 5. Start the app
npm run dev
```

Open http://localhost:3000 and sign in at `/login`.

If `prisma db seed` reports "already seeded" with a different scale, or "partially seeded state", reset the development database and seed again:

```powershell
npm run db:reset
npx prisma db seed
```

`npm run db:reset` deletes all data in `brightloop_db`. It refuses to run unless the target is the local `brightloop_db`.

### Why port 5435

The host already runs a PostgreSQL service on port 5432. The Docker container is mapped to host port 5435 to avoid that conflict. The specification states 5432, so this is a documented deviation. If you stop the host service and prefer 5432, change `compose.yaml` and both URLs in `.env`, then run `npm run db:reset`.

### Test database

Integration tests use a separate database, `brightloop_test`. Create it once:

```powershell
docker exec brightloop-db psql -U postgres -c "CREATE DATABASE brightloop_test;"
```

---

## Tests

```powershell
npm test                  # unit tests only
npm run test:integration  # integration tests against brightloop_test
```

- `npm test` does **not** run the transition integration tests.
- `npm run test:integration` runs integration tests against `brightloop_test` (includes transition integration tests; transition rules are covered only by the integration suite; requires `DATABASE_URL_TEST` pointing to `brightloop_test`).
- `npm run test:integration` resets `brightloop_test` before it runs, using committed migrations. It refuses to run unless the target is `brightloop_test` on a local host and differs from the development database.
- Integration tests must run sequentially (`fileParallelism: false`).

Test results for this build are recorded in the Status section below.

---

## Demo accounts (local development only)

| Role | Email | Password |
|---|---|---|
| Admin | admin@brightloop.demo | Demo@12345 |
| Staff | staff@brightloop.demo | Demo@12345 |
| Customer | customer@brightloop.demo | Demo@12345 |

The demo data is created by `prisma/seed.ts`. It is for local development only. The seed refuses to run in production.

---

## Role permissions

| Capability | Admin | Staff | Customer |
|---|:-:|:-:|:-:|
| Manage staff accounts | Yes | No | No |
| Manage products, variants, plans, taxes, templates | Yes | Read only | No |
| Create quotations and subscriptions | Yes | Yes | No |
| Transition subscriptions (activate, pause, close) | Yes | Yes | No |
| Assign or remove subscription discounts | Yes | No | No |
| Review customer requests | Yes | Yes | No |
| Run billing | Yes | Yes | No |
| Confirm invoices and record payments | Yes | Yes | No |
| View reports and export CSV | Yes | Yes | No |
| View own subscriptions, invoices, payments | No | No | Yes |
| Submit pause, renewal, or early-close requests | No | No | Yes |
| View simulated outbox | Yes | No | No |

Permissions are enforced on the server. Hiding a menu item is not authorization.

Staff see discount details attached to subscriptions and invoices, read only. They cannot browse or edit the discount management page.

---

## Billing behaviour

- **Catch-up:** a billing run bills every due period of each eligible subscription, up to a cap per subscription per run. The default cap is 12, set by `BILLING_MAX_PERIODS_PER_SUBSCRIPTION` in `.env`. The cap must be an integer from 1 to 120.
- **Cap counts generated invoices.** Repairs of duplicate periods are counted separately, with at most 3 per subscription per run. A fourth repair in one run indicates data corruption and fails that subscription.
- **Statuses:**
  - `COMPLETED`: no eligible work remains.
  - `COMPLETED_WITH_PENDING`: work remains, either because of the cap or because a subscription was locked during the run. Run billing again.
  - `FAILED`: the run could not finish.
- **Partially processed:** a subscription that reached the cap with periods still due is reported with its remaining count. Its next run continues from the stored cursor.
- **Pending breakdown** is stored on the run's summary audit event:
  - Awaiting invoice generation: active subscriptions with periods still due.
  - Awaiting expiry closure: active, expired, auto-close enabled, nothing left to bill.
  - Awaiting manual expiry closure: active, expired, auto-close disabled. Shown separately and not counted as pending.
- **Paused and closed subscriptions are not billed.** A paused subscription does not receive invoices until resumed.
- **Invoice totals:** discounts are allocated to product lines before GST is calculated on the discounted amount. Totals are computed with decimal.js using half-up rounding.

---

## Status

This table records what has been checked and how. "Verified" means test output or command output was seen. "Reported" means an agent reported it and it has not been independently checked. "Open" means not done.

| Area | Status | Evidence |
|---|---|---|
| Unit tests (`npm test`) | Reported | 56 passed across 7 files, per agent report. Not re-run in this review. |
| Integration tests (`npm run test:integration`) | Verified | 57 passed across 9 files in the baseline run at HEAD `688b6ba`. |
| Production build (`npm run build`) | Reported | Succeeded with 27 routes, per agent report. |
| Schema validation and migration status | Verified | `prisma validate` passed. `migrate status` reported up to date. |
| Billing catch-up, cap, and pending reporting (B1, B12, B13, B14) | Verified | Integration test output with passing results. |
| Invoice and payment concurrency (B3, B4, B10) | Verified | Integration test output with passing results. |
| Discount max-uses race (B6) | Verified | Integration test output with passing results. |
| Customer isolation (B7) | Verified | Integration test output with passing results. |
| Password reset single-use under concurrency (B11) | Verified | Integration test output with passing results. |
| Request race (B5) | Verified | Integration test output with passing results. |
| Historical invoice stability (B8) | Verified | Integration test output with passing results. |
| Reconciliation with direct SQL (N8) | Reported | A reconciliation test file exists and passed. Its scope has not been reviewed against spec §15. |
| Fixture isolation across integration files | State-verified | Fixtures sub1, sub2, subA, and subB closed by their owning files with closeReason TEST_CLEANUP; post-run SQL confirmed status CLOSED. |
| Reset-script rejection with missing environment | Open | Not executed. The source shows the check returns before any reset. |
| Load-scale seed (2,000 subscriptions) | Open | Not implemented. The seed currently produces demo scale only. |
| Page performance under 2 seconds | Open | Not measured at load scale. |
| Demo walkthrough (spec section 23) | Open | Not run end to end. |
| Seed invoice count versus spec | Known deviation | 17 invoices generated versus 40 in spec §19.3. The seed generates invoices through the billing engine, so the count reflects the active subscriptions, not padding. |
| Git history and submission | Open | No baseline commit exists yet. Remote repository state not checked. |

Verification of the non-negotiables (N1 to N10) is summarised in the table above, not claimed in full. The governing specification and its open gaps are tracked in the debt list below.

---

## Assumptions

- Prices are tax-exclusive. GST is one rate per line, with no CGST/SGST/IGST split and no HSN/SAC codes.
- Plans carry billing rules only. Prices come from subscription lines, which are snapshots of the product price plus the variant adjustment.
- There is no proration. A billing period starting on or before the expiry date is billed in full.
- Pausing does not extend the expiry date, and paused periods are not billed.
- Discounts are recurring while eligible. Usage is counted per invoice, and only when a discount contributes an amount.
- Cancelling an invoice keeps its billing period claimed. Corrections are deferred, since credit notes are out of scope.
- Draft invoices are not editable in this build.
- Subscription lines are frozen from confirmation onward.
- Historical churn counts subscriptions that were active or paused at the start of the period. A pause followed by closure counts as churn.
- Resume is a staff and admin action. Customers cannot resume.
- Closure after expiry is a staff and admin action, regardless of `allowEarlyClose`.
- Single currency (INR) and single business time zone (Asia/Kolkata).
- Staff-created customer emails are trusted for account linking.

---

## Technical notes

- **Identifiers:** raw SQL double-quotes every table and column name, because PostgreSQL folds unquoted identifiers to lower case.
- **Money:** stored as `Decimal(12,2)`. Calculations use decimal.js. Values reach the browser as strings.
- **CSV export:** cells that begin with `=`, `+`, `-`, or `@` are prefixed with an apostrophe to prevent spreadsheet formula injection.
- **Button `asChild`:** the shadcn `Button`, `DialogTrigger`, and `DialogClose` components accept `asChild`, so they can wrap other elements while keeping their types.
- **Audit ordering:** `AuditLog.seq` gives the order of events for one entity, because each writer holds that entity's row lock until the audit row is written. Global `seq` order is not commit order. Failure rows written after a rollback are written outside the lock.

---

## Known limitations and debt

- **Fixture isolation:** fixtures sub1, sub2, subA, and subB are closed with TEST_CLEANUP by their owning files. Request-race logs its closure; customer-auth and transition closures are verified at the database-state level after the test run.
- **Transition coverage:** the six transition tests run only in the integration suite.
- **Rate limiter:** the login rate limiter is in memory. It resets when the server restarts and does not work across multiple server instances.
- **Email:** all email is simulated through the outbox. Nothing is delivered.
- **Payments:** payments are recorded manually. There is no gateway.
- **Credit notes:** not implemented. Invoices are cancelled, not corrected.
- **Single currency and single GST rate per line.**
- **Draft invoices** cannot be edited.
- **Renewal from today** can move the billing day after a month-end renewal. This is a known consequence of the renewal rule.
- **Stale runs:** a billing run that crashes leaves its row in `RUNNING`. Later runs ignore it, and nothing cleans it up.
- **Expired subscriptions awaiting manual closure** are skipped on every run until staff close them.
- **Customer account linking** trusts the email entered by staff.
- **Registration** reveals whether an email address already has an account.
- **Sessions:** invalidated by a version counter. There is no list of active sessions to revoke individually.
- **Invoice number gaps** appear when invoices are cancelled. The numbers are never reused.
- **Seed deviation:** 17 invoices versus the 40 described in spec §19.3.
- **Load testing:** the 2,000-subscription load seed and the page timing check are not done.
- **Odoo:** integration is not implemented. It is not required by the problem statement; Odoo appears only as a product variant brand.
- **Reset-script check:** the rejection path for a missing `DATABASE_URL_TEST` has not been executed.

---

## Repository layout

```
app/          routes, pages, and server actions
lib/          services, billing engine, calculations, auth, and database access
prisma/       schema, migrations, and seed
scripts/      guard and test-reset scripts
tests/        integration tests
```

Unit tests sit beside the code they test, in `__tests__` folders.
