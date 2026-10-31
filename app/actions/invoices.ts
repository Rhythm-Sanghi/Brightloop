'use server';

import { revalidatePath } from 'next/cache';
import { requireStaffSession } from '@/lib/auth/guard';
import { confirmInvoice, cancelInvoice, sendInvoiceToOutbox } from '@/lib/services/invoices';
import { AppError } from '@/lib/errors';

export async function confirmInvoiceAction(invoiceId: string) {
  try {
    const session = await requireStaffSession();
    const invoice = await confirmInvoice(invoiceId, session.userId);

    revalidatePath('/invoices');
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath('/dashboard');

    return { success: true, invoice };
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message, code: err.code };
    }
    const message = err instanceof Error ? err.message : 'Failed to confirm invoice';
    return { success: false, error: message };
  }
}

export async function cancelInvoiceAction(invoiceId: string, reason?: string) {
  try {
    const session = await requireStaffSession();
    const invoice = await cancelInvoice(invoiceId, session.userId, reason);

    revalidatePath('/invoices');
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath('/dashboard');

    return { success: true, invoice };
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message, code: err.code };
    }
    const message = err instanceof Error ? err.message : 'Failed to cancel invoice';
    return { success: false, error: message };
  }
}

export async function sendInvoiceToOutboxAction(invoiceId: string) {
  try {
    const session = await requireStaffSession();
    const outbox = await sendInvoiceToOutbox(invoiceId, session.userId);

    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath('/outbox');

    return { success: true, outboxId: outbox.id };
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message, code: err.code };
    }
    const message = err instanceof Error ? err.message : 'Failed to send invoice';
    return { success: false, error: message };
  }
}
