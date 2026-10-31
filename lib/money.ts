import Decimal from 'decimal.js';
import { z } from 'zod';

// Configure decimal.js for financial calculations
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export function toDecimal(val: unknown): Decimal {
  if (val === null || val === undefined) {
    return new Decimal(0);
  }
  if (val instanceof Decimal) {
    return val;
  }
  return new Decimal(val.toString());
}

export function round2(val: Decimal): Decimal {
  return val.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function moneyString(val: Decimal | number | string | null | undefined): string {
  if (val === null || val === undefined) return '0.00';
  const dec = toDecimal(val);
  return round2(dec).toFixed(2);
}

export const moneyInputSchema = z
  .string()
  .regex(
    /^\d{1,10}(\.\d{1,2})?$/,
    'Must be a valid decimal amount with up to 10 digits and at most 2 decimal places.'
  );

export const positiveMoneyInputSchema = moneyInputSchema.refine(
  (val) => toDecimal(val).greaterThan(0),
  { message: 'Amount must be greater than zero.' }
);

export const SIMPLIFIED_INVOICE_FOOTER =
  'Simplified invoice: single tax rate per line. CGST/SGST/IGST split and HSN/SAC codes are not shown.';
