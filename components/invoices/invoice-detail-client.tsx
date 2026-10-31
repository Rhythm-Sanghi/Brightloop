'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle,
  CreditCard,
  Mail,
  Printer,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  confirmInvoiceAction,
  cancelInvoiceAction,
  sendInvoiceToOutboxAction,
} from '@/app/actions/invoices';
import { recordPaymentAction } from '@/app/actions/payments';
import { PAYMENT_METHODS, PaymentMethod } from '@/lib/constants';

export interface InvoiceDetailProps {
  invoice: {
    id: string;
    number: string | null;
    status: string;
    isOverdue: boolean;
    periodStart: string;
    periodEnd: string;
    issueDate: string;
    dueDate: string;
    subtotal: string;
    discountTotal: string;
    taxableTotal: string;
    taxTotal: string;
    total: string;
    amountPaid: string;
    balance: string;
    cancelledAt: string | null;
    customer: {
      id: string;
      name: string;
      email: string;
    };
    subscription: {
      id: string;
      number: string | null;
      plan: {
        name: string;
      };
    };
    lines: {
      id: string;
      description: string;
      quantity: number;
      unitPrice: string;
      grossAmount: string;
      allocatedDiscount: string;
      taxableAmount: string;
      taxRatePercent: string;
      taxAmount: string;
      product: { name: string };
      variant?: { name: string } | null;
    }[];
    discounts: {
      id: string;
      amount: string;
      discount: {
        name: string;
        kind: string;
        scope: string;
      };
    }[];
    payments: {
      id: string;
      amount: string;
      method: string;
      paidOn: string;
      note: string | null;
      recordedBy: { name: string };
    }[];
  };
}

export function InvoiceDetailClient({ invoice }: InvoiceDetailProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(invoice.balance);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [paymentNote, setPaymentNote] = useState('');

  // Cancel modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const handleConfirm = async () => {
    setIsSubmitting(true);
    const toastId = toast.loading('Confirming invoice...');
    try {
      const res = await confirmInvoiceAction(invoice.id);
      if (res.success) {
        toast.success(`Invoice confirmed as ${res.invoice?.number}`, { id: toastId });
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to confirm invoice', { id: toastId });
      }
    } catch {
      toast.error('Unexpected error', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendToOutbox = async () => {
    setIsSubmitting(true);
    const toastId = toast.loading('Sending invoice to simulated outbox...');
    try {
      const res = await sendInvoiceToOutboxAction(invoice.id);
      if (res.success) {
        toast.success('Invoice queued in simulated outbox! Delivery is simulated.', {
          id: toastId,
        });
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to send invoice', { id: toastId });
      }
    } catch {
      toast.error('Unexpected error', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const toastId = toast.loading('Recording payment...');
    try {
      const res = await recordPaymentAction({
        invoiceId: invoice.id,
        amount: paymentAmount,
        method: paymentMethod,
        note: paymentNote,
      });

      if (res.success) {
        toast.success(
          res.isFullyPaid
            ? 'Payment recorded! Invoice is now PAID in full.'
            : 'Partial payment recorded successfully.',
          { id: toastId }
        );
        setShowPaymentModal(false);
        router.refresh();
      } else {
        toast.error(res.error || 'Payment failed', { id: toastId });
      }
    } catch {
      toast.error('Unexpected error recording payment', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelInvoice = async () => {
    setIsSubmitting(true);
    const toastId = toast.loading('Cancelling invoice...');
    try {
      const res = await cancelInvoiceAction(invoice.id, cancelReason);
      if (res.success) {
        toast.success('Invoice cancelled successfully', { id: toastId });
        setShowCancelModal(false);
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to cancel invoice', { id: toastId });
      }
    } catch {
      toast.error('Unexpected error', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = () => {
    if (invoice.status === 'DRAFT') {
      return (
        <Badge variant="outline" className="text-muted-foreground border-dashed">
          DRAFT
        </Badge>
      );
    }
    if (invoice.status === 'PAID') {
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1">
          <CheckCircle className="h-3 w-3" /> PAID
        </Badge>
      );
    }
    if (invoice.status === 'CANCELLED') {
      return (
        <Badge className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1">
          <XCircle className="h-3 w-3" /> CANCELLED
        </Badge>
      );
    }
    if (invoice.isOverdue) {
      return (
        <Badge className="bg-rose-500 hover:bg-rose-600 text-white flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> OVERDUE
        </Badge>
      );
    }
    return (
      <Badge className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1">
        <Clock className="h-3 w-3" /> CONFIRMED
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/invoices">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {invoice.number || 'Draft Invoice'}
              </h1>
              {getStatusBadge()}
            </div>
            <p className="text-muted-foreground text-sm">
              Issued on {invoice.issueDate} • Due on {invoice.dueDate}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {invoice.status === 'DRAFT' && (
            <>
              <Button
                variant="outline"
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                onClick={() => setShowCancelModal(true)}
                disabled={isSubmitting}
              >
                <XCircle className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-1" />
                )}
                Confirm Invoice
              </Button>
            </>
          )}

          {invoice.status === 'CONFIRMED' && (
            <>
              {parseFloat(invoice.amountPaid) === 0 && (
                <Button
                  variant="outline"
                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  onClick={() => setShowCancelModal(true)}
                  disabled={isSubmitting}
                >
                  <XCircle className="h-4 w-4 mr-1" /> Cancel
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleSendToOutbox}
                disabled={isSubmitting}
              >
                <Mail className="h-4 w-4 mr-1" /> Send to Customer
              </Button>
              <Button
                variant="outline"
                asChild
              >
                <Link href={`/invoices/${invoice.id}/print`} target="_blank">
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Link>
              </Button>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => {
                  setPaymentAmount(invoice.balance);
                  setShowPaymentModal(true);
                }}
                disabled={isSubmitting}
              >
                <CreditCard className="h-4 w-4 mr-1" /> Record Payment
              </Button>
            </>
          )}

          {invoice.status === 'PAID' && (
            <>
              <Button
                variant="outline"
                onClick={handleSendToOutbox}
                disabled={isSubmitting}
              >
                <Mail className="h-4 w-4 mr-1" /> Send Receipt
              </Button>
              <Button
                variant="outline"
                asChild
              >
                <Link href={`/invoices/${invoice.id}/print`} target="_blank">
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Customer & Subscription Metadata */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Billing & Subscription Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground block text-xs">Customer</span>
              <span className="font-medium text-foreground">{invoice.customer.name}</span>
              <span className="text-muted-foreground block text-xs">{invoice.customer.email}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">Subscription</span>
              <Link
                href={`/subscriptions/${invoice.subscription.id}`}
                className="font-medium text-primary hover:underline"
              >
                {invoice.subscription.number || invoice.subscription.id.slice(0, 8)}
              </Link>
              <span className="text-muted-foreground block text-xs">
                Plan: {invoice.subscription.plan.name}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">Billing Period</span>
              <span className="font-medium">
                {invoice.periodStart} to {invoice.periodEnd}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">Payment Terms</span>
              <span className="font-medium">Due by {invoice.dueDate}</span>
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Invoice Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>₹{parseFloat(invoice.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            {parseFloat(invoice.discountTotal) > 0 && (
              <div className="flex justify-between text-emerald-600 font-medium">
                <span>Discounts</span>
                <span>-₹{parseFloat(invoice.discountTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Taxable Subtotal</span>
              <span>₹{parseFloat(invoice.taxableTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">GST Tax</span>
              <span>₹{parseFloat(invoice.taxTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold text-base">
              <span>Total Amount</span>
              <span>₹{parseFloat(invoice.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
              <span>Amount Paid</span>
              <span>₹{parseFloat(invoice.amountPaid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold text-rose-600 text-base">
              <span>Outstanding Balance</span>
              <span>₹{parseFloat(invoice.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoice Line Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line Items</CardTitle>
          <CardDescription>Itemized billing lines with allocated discounts and GST.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">Tax %</TableHead>
                  <TableHead className="text-right">Tax Amount</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((line) => {
                  const lineTotal = (
                    parseFloat(line.taxableAmount) + parseFloat(line.taxAmount)
                  ).toFixed(2);
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{line.product.name}</div>
                        {line.variant && (
                          <div className="text-xs text-muted-foreground">
                            Variant: {line.variant.name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{line.quantity}</TableCell>
                      <TableCell className="text-right">
                        ₹{parseFloat(line.unitPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600 font-medium">
                        {parseFloat(line.allocatedDiscount) > 0
                          ? `-₹${parseFloat(line.allocatedDiscount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                          : '₹0.00'}
                      </TableCell>
                      <TableCell className="text-right">
                        ₹{parseFloat(line.taxableAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {parseFloat(line.taxRatePercent)}%
                      </TableCell>
                      <TableCell className="text-right">
                        ₹{parseFloat(line.taxAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        ₹{parseFloat(lineTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Applied Discounts */}
      {invoice.discounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Applied Discounts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Discount Name</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Applied Reduction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.discounts.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.discount.name}</TableCell>
                    <TableCell className="text-xs font-mono">{d.discount.scope}</TableCell>
                    <TableCell className="text-xs">{d.discount.kind}</TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600">
                      -₹{parseFloat(d.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Collections</CardTitle>
          <CardDescription>
            Audit history of payments received and credited towards this invoice.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {invoice.payments.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No payments recorded yet for this invoice.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Recorded By</TableHead>
                  <TableHead>Note / Ref</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{new Date(p.paidOn).toISOString().split('T')[0]}</TableCell>
                    <TableCell className="font-mono text-xs">{p.method}</TableCell>
                    <TableCell className="text-xs">{p.recordedBy.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.note || '-'}</TableCell>
                    <TableCell className="text-right font-semibold text-emerald-700 dark:text-emerald-400">
                      ₹{parseFloat(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Record Payment Dialog */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent>
          <form onSubmit={handleRecordPayment}>
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
              <DialogDescription>
                Record collection against invoice {invoice.number || invoice.id}. Outstanding balance is ₹{invoice.balance}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="payment-amount">Payment Amount (₹)</Label>
                <Input
                  id="payment-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={invoice.balance}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="payment-method">Payment Method</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(val) => setPaymentMethod(val as PaymentMethod)}
                >
                  <SelectTrigger id="payment-method">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="payment-note">Reference / Note (Optional)</Label>
                <Input
                  id="payment-note"
                  placeholder="e.g. Bank Ref #123456"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowPaymentModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-1" />
                )}
                Submit Payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={showCancelModal} onOpenChange={setShowCancelModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Invoice</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this invoice? This action cannot be undone.
              Any claimed discounts will be released back to the pool.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="cancel-reason">Reason for cancellation (Optional)</Label>
            <Input
              id="cancel-reason"
              placeholder="e.g. Billed in error, plan upgraded"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelModal(false)}>
              Keep Invoice
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelInvoice}
              disabled={isSubmitting}
            >
              Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
