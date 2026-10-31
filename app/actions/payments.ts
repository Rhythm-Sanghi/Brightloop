'use server';

import { revalidatePath } from 'next/cache';
import { requireStaffSession } from '@/lib/auth/guard';
import { recordPayment } from '@/lib/services/payments';
import { PaymentMethod } from '@/lib/constants';
import { parseBusinessDate } from '@/lib/dates/business-date';
import { AppError } from '@/lib/errors';

export async function recordPaymentAction(data: {
  invoiceId: string;
  amount: string | number;
  method: PaymentMethod;
  paidOn?: string;
  note?: string;
}) {
  try {
    const session = await requireStaffSession();
    const paidOn = data.paidOn ? parseBusinessDate(data.paidOn) : new Date();

    const result = await recordPayment({
      invoiceId: data.invoiceId,
      amount: data.amount,
      method: data.method,
      paidOn,
      note: data.note,
      recordedById: session.userId,
    });

    revalidatePath('/invoices');
    revalidatePath(`/invoices/${data.invoiceId}`);
    revalidatePath('/payments');
    revalidatePath('/dashboard');

    return {
      success: true,
      payment: result.payment,
      newAmountPaid: result.newAmountPaid,
      isFullyPaid: result.isFullyPaid,
      invoiceStatus: result.invoiceStatus,
    };
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message, code: err.code };
    }
    const message = err instanceof Error ? err.message : 'Failed to record payment';
    return { success: false, error: message };
  }
}
