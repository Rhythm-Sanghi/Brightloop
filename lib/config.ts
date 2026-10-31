export function parseBillingMaxPeriods(val?: string | null): number {
  if (val === undefined || val === null || val === '') {
    return 12;
  }
  // Must be a valid integer representation without trailing characters
  if (!/^-?\d+$/.test(val.trim())) {
    throw new Error(`BILLING_MAX_PERIODS_PER_SUBSCRIPTION must be an integer from 1 to 120, got: "${val}"`);
  }
  const parsed = parseInt(val.trim(), 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 120) {
    throw new Error(`BILLING_MAX_PERIODS_PER_SUBSCRIPTION must be an integer from 1 to 120, got: "${val}"`);
  }
  return parsed;
}

export const BILLING_MAX_PERIODS_PER_SUBSCRIPTION = parseBillingMaxPeriods(
  process.env.BILLING_MAX_PERIODS_PER_SUBSCRIPTION
);

export const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
export const SESSION_SECRET = process.env.SESSION_SECRET || 'brightloop-fallback-secret-at-least-32-chars';
