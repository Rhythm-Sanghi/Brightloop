'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  XCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
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
import { submitCustomerRequestAction } from '@/app/actions/subscriptions';
import { RequestType } from '@/lib/constants';

interface PortalSubscriptionDetailProps {
  subscription: {
    id: string;
    number: string | null;
    status: string;
    startDate: string;
    expiryDate: string | null;
    nextBillingDate: string | null;
    renewalCount: number;
    paymentTermsDays: number;
    plan: {
      name: string;
      billingPeriod: string;
      billingInterval: number;
      allowPause: boolean;
      allowRenewal: boolean;
      allowEarlyClose: boolean;
    };
    lines: {
      id: string;
      productName: string;
      variantName: string | null;
      quantity: number;
      unitPrice: string;
    }[];
    pendingRequest: {
      id: string;
      requestType: string;
      requestedAt: string;
      customerNote: string | null;
    } | null;
  };
}

export function PortalSubscriptionDetailClient({ subscription: sub }: PortalSubscriptionDetailProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeModal, setActiveModal] = useState<RequestType | null>(null);
  const [requestNote, setRequestNote] = useState('');

  const handleOpenModal = (type: RequestType) => {
    setActiveModal(type);
    setRequestNote('');
  };

  const handleSubmitRequest = async () => {
    if (!activeModal) return;
    setIsSubmitting(true);
    const toastId = toast.loading(`Submitting ${activeModal.toLowerCase()} request...`);
    try {
      const res = await submitCustomerRequestAction(sub.id, activeModal, requestNote);
      if (res.success) {
        toast.success('Your request has been submitted for staff review.', { id: toastId });
        setActiveModal(null);
        router.refresh();
      } else {
        toast.error(res.error?.message || 'Failed to submit request', { id: toastId });
      }
    } catch {
      toast.error('Unexpected error submitting request', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 w-fit">
            <CheckCircle2 className="h-3 w-3" /> ACTIVE
          </Badge>
        );
      case 'PAUSED':
        return (
          <Badge className="bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1 w-fit">
            <PauseCircle className="h-3 w-3" /> PAUSED
          </Badge>
        );
      case 'CLOSED':
        return (
          <Badge className="bg-gray-600 hover:bg-gray-700 text-white flex items-center gap-1 w-fit">
            <XCircle className="h-3 w-3" /> CLOSED
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const hasPending = !!sub.pendingRequest;
  const canPause = sub.status === 'ACTIVE' && sub.plan.allowPause && !hasPending;
  const canRenew = (sub.status === 'ACTIVE' || sub.status === 'PAUSED') && sub.plan.allowRenewal && !!sub.expiryDate && !hasPending;
  const canClose = (sub.status === 'ACTIVE' || sub.status === 'PAUSED') && sub.plan.allowEarlyClose && !hasPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/portal/subscriptions">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Subscriptions
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {sub.number || 'Subscription Details'}
              </h1>
              {getStatusBadge(sub.status)}
            </div>
            <p className="text-sm text-muted-foreground">Plan: {sub.plan.name}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {canPause && (
            <Button
              variant="outline"
              className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              onClick={() => handleOpenModal('PAUSE')}
              disabled={isSubmitting}
            >
              <PauseCircle className="h-4 w-4 mr-1" /> Request Pause
            </Button>
          )}

          {canRenew && (
            <Button
              variant="outline"
              className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
              onClick={() => handleOpenModal('RENEW')}
              disabled={isSubmitting}
            >
              <RefreshCw className="h-4 w-4 mr-1" /> Request Renewal
            </Button>
          )}

          {canClose && (
            <Button
              variant="outline"
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              onClick={() => handleOpenModal('EARLY_CLOSE')}
              disabled={isSubmitting}
            >
              <XCircle className="h-4 w-4 mr-1" /> Request Cancellation
            </Button>
          )}
        </div>
      </div>

      {/* Pending Request Alert */}
      {sub.pendingRequest && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="pt-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
                Pending {sub.pendingRequest.requestType} Request
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                You submitted a {sub.pendingRequest.requestType.toLowerCase()} request on{' '}
                {sub.pendingRequest.requestedAt}. Our support staff will review and process your
                request shortly.
              </p>
              {sub.pendingRequest.customerNote && (
                <p className="text-xs italic text-amber-700 dark:text-amber-400">
                  Note: "{sub.pendingRequest.customerNote}"
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscription Information Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billing & Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Start Date:</span>
              <span className="font-medium">{sub.startDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expiry Date:</span>
              <span className="font-medium">{sub.expiryDate || 'Continuous / No Expiry'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Next Billing Date:</span>
              <span className="font-medium">{sub.nextBillingDate || 'Current'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Billing Frequency:</span>
              <span className="font-medium">
                {sub.plan.billingInterval > 1 ? `Every ${sub.plan.billingInterval} ` : 'Every '}
                {sub.plan.billingPeriod.toLowerCase()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Renewals Completed:</span>
              <span className="font-medium">{sub.renewalCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan Terms & Privileges</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Pause Support:</span>
              {sub.plan.allowPause ? (
                <Badge variant="outline" className="text-emerald-700 bg-emerald-50">Allowed</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">Not Permitted</Badge>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Renewal Support:</span>
              {sub.plan.allowRenewal ? (
                <Badge variant="outline" className="text-emerald-700 bg-emerald-50">Allowed</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">Not Permitted</Badge>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Early Termination:</span>
              {sub.plan.allowEarlyClose ? (
                <Badge variant="outline" className="text-emerald-700 bg-emerald-50">Allowed</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">Not Permitted</Badge>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Payment Terms:</span>
              <span className="font-medium">{sub.paymentTermsDays} days net</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Subscription Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subscribed Items</CardTitle>
          <CardDescription>Products and services included under this subscription.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-center">Quantity</TableHead>
                <TableHead className="text-right">Unit Price (₹)</TableHead>
                <TableHead className="text-right">Total Price (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sub.lines.map((line) => {
                const total = (parseFloat(line.unitPrice) * line.quantity).toFixed(2);
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{line.productName}</div>
                      {line.variantName && (
                        <div className="text-xs text-muted-foreground">
                          Variant: {line.variantName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{line.quantity}</TableCell>
                    <TableCell className="text-right">
                      ₹{parseFloat(line.unitPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      ₹{parseFloat(total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Request Modal */}
      <Dialog open={!!activeModal} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {activeModal === 'PAUSE' && 'Request Subscription Pause'}
              {activeModal === 'RENEW' && 'Request Subscription Renewal'}
              {activeModal === 'EARLY_CLOSE' && 'Request Subscription Cancellation'}
            </DialogTitle>
            <DialogDescription>
              {activeModal === 'PAUSE' &&
                'Submit a request to temporarily pause billing for this subscription. Our team will review your request.'}
              {activeModal === 'RENEW' &&
                'Submit a request to renew this subscription for another billing cycle.'}
              {activeModal === 'EARLY_CLOSE' &&
                'Submit a request to terminate this subscription early.'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="req-note">Reason or Note (Optional)</Label>
            <Input
              id="req-note"
              placeholder="e.g. Taking leave next month / Project extended"
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveModal(null)}>
              Cancel
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleSubmitRequest}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
