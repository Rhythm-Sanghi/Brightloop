import { z } from 'zod';

export const ROLES = ['ADMIN', 'STAFF', 'CUSTOMER'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const BILLING_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export const BillingPeriodSchema = z.enum(BILLING_PERIODS);
export type BillingPeriod = z.infer<typeof BillingPeriodSchema>;

export const SUBSCRIPTION_STATUSES = [
  'DRAFT',
  'QUOTATION',
  'CONFIRMED',
  'ACTIVE',
  'PAUSED',
  'CLOSED',
] as const;
export const SubscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const TRANSITION_ACTIONS = [
  'SEND_QUOTATION',
  'DISCARD',
  'CONFIRM_QUOTATION',
  'CANCEL_QUOTATION',
  'ACTIVATE',
  'CANCEL',
  'PAUSE',
  'RESUME',
  'EARLY_CLOSE',
  'EXPIRY_CLOSE',
] as const;
export const TransitionActionSchema = z.enum(TRANSITION_ACTIONS);
export type TransitionAction = z.infer<typeof TransitionActionSchema>;

export const REQUEST_TYPES = ['PAUSE', 'RENEW', 'EARLY_CLOSE'] as const;
export const RequestTypeSchema = z.enum(REQUEST_TYPES);
export type RequestType = z.infer<typeof RequestTypeSchema>;

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const RequestStatusSchema = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const DISCOUNT_KINDS = ['FIXED', 'PERCENT'] as const;
export const DiscountKindSchema = z.enum(DISCOUNT_KINDS);
export type DiscountKind = z.infer<typeof DiscountKindSchema>;

export const DISCOUNT_SCOPES = ['PRODUCT', 'SUBSCRIPTION'] as const;
export const DiscountScopeSchema = z.enum(DISCOUNT_SCOPES);
export type DiscountScope = z.infer<typeof DiscountScopeSchema>;

export const INVOICE_STATUSES = ['DRAFT', 'CONFIRMED', 'PAID', 'CANCELLED'] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const PAYMENT_METHODS = [
  'BANK_TRANSFER',
  'CREDIT_CARD',
  'UPI',
  'CASH',
  'CHEQUE',
] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const BILLING_RUN_STATUSES = [
  'RUNNING',
  'COMPLETED',
  'COMPLETED_WITH_PENDING',
  'FAILED',
] as const;
export const BillingRunStatusSchema = z.enum(BILLING_RUN_STATUSES);
export type BillingRunStatus = z.infer<typeof BillingRunStatusSchema>;

export const BILLING_OUTCOMES = [
  'FULLY_PROCESSED',
  'PARTIALLY_PROCESSED',
  'SKIPPED',
  'FAILED',
] as const;
export const BillingOutcomeSchema = z.enum(BILLING_OUTCOMES);
export type BillingOutcome = z.infer<typeof BillingOutcomeSchema>;

export const EMAIL_OUTBOX_KINDS = [
  'PASSWORD_RESET',
  'STAFF_WELCOME',
  'INVOICE_SENT',
] as const;
export const EmailOutboxKindSchema = z.enum(EMAIL_OUTBOX_KINDS);
export type EmailOutboxKind = z.infer<typeof EmailOutboxKindSchema>;
