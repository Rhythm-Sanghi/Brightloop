import Decimal from 'decimal.js';
import { round2 } from '../money';

export interface RawInvoiceLineInput {
  productId: string;
  variantId?: string | null;
  description: string;
  quantity: number;
  unitPrice: Decimal;
  allocatedDiscount?: Decimal;
  taxRatePercent: Decimal; // e.g. 18.00
  taxId?: string | null;
  sortOrder: number;
}

export interface CalculatedInvoiceLine {
  productId: string;
  variantId?: string | null;
  description: string;
  quantity: number;
  unitPrice: Decimal;
  grossAmount: Decimal;
  allocatedDiscount: Decimal;
  taxableAmount: Decimal;
  taxId?: string | null;
  taxRatePercent: Decimal;
  taxAmount: Decimal;
  sortOrder: number;
}

export interface CalculatedInvoiceTotals {
  subtotal: Decimal;
  discountTotal: Decimal;
  taxableTotal: Decimal;
  taxTotal: Decimal;
  total: Decimal;
  lines: CalculatedInvoiceLine[];
}

export function calculateInvoiceTotals(rawLines: RawInvoiceLineInput[]): CalculatedInvoiceTotals {
  let subtotal = new Decimal(0);
  let discountTotal = new Decimal(0);
  let taxableTotal = new Decimal(0);
  let taxTotal = new Decimal(0);

  const calculatedLines: CalculatedInvoiceLine[] = [];

  for (const raw of rawLines) {
    const grossAmount = round2(new Decimal(raw.quantity).times(raw.unitPrice));
    const allocatedDiscount = round2(raw.allocatedDiscount || new Decimal(0));
    const taxableAmount = round2(grossAmount.minus(allocatedDiscount));
    const taxAmount = round2(taxableAmount.times(raw.taxRatePercent).dividedBy(100));

    subtotal = subtotal.plus(grossAmount);
    discountTotal = discountTotal.plus(allocatedDiscount);
    taxableTotal = taxableTotal.plus(taxableAmount);
    taxTotal = taxTotal.plus(taxAmount);

    calculatedLines.push({
      productId: raw.productId,
      variantId: raw.variantId ?? null,
      description: raw.description,
      quantity: raw.quantity,
      unitPrice: raw.unitPrice,
      grossAmount,
      allocatedDiscount,
      taxableAmount,
      taxId: raw.taxId ?? null,
      taxRatePercent: raw.taxRatePercent,
      taxAmount,
      sortOrder: raw.sortOrder,
    });
  }

  subtotal = round2(subtotal);
  discountTotal = round2(discountTotal);
  taxableTotal = round2(taxableTotal);
  taxTotal = round2(taxTotal);
  const total = round2(taxableTotal.plus(taxTotal));

  // Critical specification invariant:
  // taxableTotal must equal subtotal - discountTotal
  const expectedTaxableTotal = round2(subtotal.minus(discountTotal));
  if (!taxableTotal.equals(expectedTaxableTotal)) {
    throw new Error(
      `Financial invariant violated: taxableTotal (${taxableTotal.toString()}) does not equal subtotal - discountTotal (${expectedTaxableTotal.toString()})`
    );
  }

  return {
    subtotal,
    discountTotal,
    taxableTotal,
    taxTotal,
    total,
    lines: calculatedLines,
  };
}
