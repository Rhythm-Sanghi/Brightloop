import Decimal from 'decimal.js';
import { round2 } from '../money';

export interface InvoiceForOverdue {
  status: string;
  dueDate: Date;
  total: Decimal;
  amountPaid: Decimal;
}

export function isInvoiceOverdue(invoice: InvoiceForOverdue, today: Date): boolean {
  if (invoice.status !== 'CONFIRMED') return false;

  const dueTime = invoice.dueDate.getTime();
  const todayTime = today.getTime();
  if (dueTime >= todayTime) return false;

  const balance = round2(invoice.total.minus(invoice.amountPaid));
  return balance.greaterThan(0);
}
