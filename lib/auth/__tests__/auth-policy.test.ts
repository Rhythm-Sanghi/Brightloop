import { describe, it, expect } from 'vitest';
import { passwordSchema } from '../../validations/auth';
import { normalizeEmail } from '../../normalize';
import { can } from '../../permissions';
import { createSessionToken, verifySessionToken } from '../session';

describe('Password Policy Validation', () => {
  it('accepts compliant passwords (>=9 chars, uppercase, lowercase, special)', () => {
    expect(passwordSchema.safeParse('Admin@123').success).toBe(true);
    expect(passwordSchema.safeParse('Demo@12345').success).toBe(true);
    expect(passwordSchema.safeParse('Str0ng!Pass').success).toBe(true);
  });

  it('rejects passwords shorter than 9 characters', () => {
    const res = passwordSchema.safeParse('Pass@123'); // 8 chars
    expect(res.success).toBe(false);
  });

  it('rejects passwords missing uppercase', () => {
    const res = passwordSchema.safeParse('password@123');
    expect(res.success).toBe(false);
  });

  it('rejects passwords missing lowercase', () => {
    const res = passwordSchema.safeParse('PASSWORD@123');
    expect(res.success).toBe(false);
  });

  it('rejects passwords missing special characters', () => {
    const res = passwordSchema.safeParse('Password123');
    expect(res.success).toBe(false);
  });
});

describe('Email Normalization', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('converts to lowercase', () => {
    expect(normalizeEmail('Admin.User@BrightLoop.Demo')).toBe('admin.user@brightloop.demo');
  });

  it('is idempotent', () => {
    const first = normalizeEmail('  Test.Person@Domain.COM ');
    expect(normalizeEmail(first)).toBe(first);
  });
});

describe('Permissions Matrix can(role, action)', () => {
  it('ADMIN can perform all actions', () => {
    expect(can('ADMIN', 'manage:staff')).toBe(true);
    expect(can('ADMIN', 'manage:discounts')).toBe(true);
    expect(can('ADMIN', 'manage:products')).toBe(true);
    expect(can('ADMIN', 'manage:invoices')).toBe(true);
  });

  it('STAFF cannot perform admin-only actions', () => {
    expect(can('STAFF', 'manage:staff')).toBe(false);
    expect(can('STAFF', 'manage:taxes')).toBe(false);
    expect(can('STAFF', 'manage:discounts')).toBe(false);
    expect(can('STAFF', 'assign:subscription_discounts')).toBe(false);
    expect(can('STAFF', 'manage:products')).toBe(false);
    expect(can('STAFF', 'manage:plans')).toBe(false);
    expect(can('STAFF', 'manage:templates')).toBe(false);
    expect(can('STAFF', 'view:outbox')).toBe(false);
    expect(can('STAFF', 'manage:settings')).toBe(false);
  });

  it('STAFF can perform operational actions', () => {
    expect(can('STAFF', 'manage:customers')).toBe(true);
    expect(can('STAFF', 'manage:subscriptions')).toBe(true);
    expect(can('STAFF', 'manage:requests')).toBe(true);
    expect(can('STAFF', 'manage:invoices')).toBe(true);
    expect(can('STAFF', 'manage:payments')).toBe(true);
    expect(can('STAFF', 'run:billing')).toBe(true);
    expect(can('STAFF', 'view:reports')).toBe(true);
    expect(can('STAFF', 'view:audit_logs')).toBe(true);
  });

  it('CUSTOMER only has portal access', () => {
    expect(can('CUSTOMER', 'portal:access')).toBe(true);
    expect(can('CUSTOMER', 'manage:customers')).toBe(false);
    expect(can('CUSTOMER', 'run:billing')).toBe(false);
  });
});

describe('Session Token Creation & Verification', () => {
  it('creates and verifies valid session tokens with sub and sv', async () => {
    const token = await createSessionToken({ sub: 'user_123', sv: 0 });
    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user_123');
    expect(payload?.sv).toBe(0);
  });

  it('rejects tampered or malformed tokens', async () => {
    const payload = await verifySessionToken('invalid.token.signature');
    expect(payload).toBeNull();
  });
});
