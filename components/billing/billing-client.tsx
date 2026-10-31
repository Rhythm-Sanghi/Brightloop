'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Play, Loader2, CheckCircle, AlertTriangle, XCircle, Clock, Eye, RefreshCw } from 'lucide-react';
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
import { triggerBillingRunAction, getBillingRunDetailsAction } from '@/app/actions/billing';

interface BillingRunItem {
  id: string;
  runDate: Date | string;
  status: string;
  maxPeriodsPerSubscription: number;
  invoicesGenerated: number;
  subscriptionsFullyProcessed: number;
  subscriptionsPartiallyProcessed: number;
  subscriptionsSkipped: number;
  subscriptionsFailed: number;
  subscriptionsPending: number;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  startedBy?: { name: string; email: string } | null;
}

interface OutcomeDetail {
  id: string;
  subscriptionId: string;
  subscriptionNumber: string;
  customerName: string;
  customerEmail: string;
  outcome: string;
  invoicesGenerated: number;
  reason: string | null;
  timestamp: Date | string;
}

interface BillingClientProps {
  initialRuns: BillingRunItem[];
}

export function BillingClient({ initialRuns }: BillingClientProps) {
  const router = useRouter();
  const [runs, setRuns] = useState<BillingRunItem[]>(initialRuns);
  const [isRunning, setIsRunning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedRun, setSelectedRun] = useState<BillingRunItem | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeDetail[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const latestRun = runs[0] || null;

  const handleStartRun = async () => {
    setShowConfirm(false);
    setIsRunning(true);
    const toastId = toast.loading('Running billing engine...');
    try {
      const res = await triggerBillingRunAction();
      if (!res.success) {
        toast.error(res.error || 'Billing run failed', { id: toastId });
      } else {
        toast.success(
          `Billing run completed: ${res.run?.invoicesGenerated ?? 0} invoices generated.`,
          { id: toastId }
        );
        router.refresh();
      }
    } catch {
      toast.error('Unexpected error while executing billing run', { id: toastId });
    } finally {
      setIsRunning(false);
    }
  };

  const handleViewDetails = async (run: BillingRunItem) => {
    setSelectedRun(run);
    setIsLoadingDetails(true);
    setOutcomes([]);
    try {
      const res = await getBillingRunDetailsAction(run.id);
      if (res.success && res.outcomes) {
        setOutcomes(res.outcomes);
      } else {
        toast.error(res.error || 'Failed to fetch run details');
      }
    } catch {
      toast.error('Error loading outcome details');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 w-fit">
            <CheckCircle className="h-3 w-3" /> COMPLETED
          </Badge>
        );
      case 'COMPLETED_WITH_PENDING':
        return (
          <Badge className="bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1 w-fit">
            <AlertTriangle className="h-3 w-3" /> PENDING WORK
          </Badge>
        );
      case 'RUNNING':
        return (
          <Badge className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 w-fit">
            <Loader2 className="h-3 w-3 animate-spin" /> RUNNING
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1 w-fit">
            <XCircle className="h-3 w-3" /> FAILED
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getOutcomeBadge = (outcome: string) => {
    switch (outcome) {
      case 'FULLY_PROCESSED':
        return <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300">FULLY PROCESSED</Badge>;
      case 'PARTIALLY_PROCESSED':
        return <Badge className="bg-amber-100 text-amber-800 border border-amber-300">PARTIAL (CAPPED)</Badge>;
      case 'SKIPPED':
        return <Badge className="bg-gray-100 text-gray-800 border border-gray-300">SKIPPED</Badge>;
      case 'FAILED':
        return <Badge className="bg-rose-100 text-rose-800 border border-rose-300">FAILED</Badge>;
      default:
        return <Badge variant="outline">{outcome}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing Runs</h1>
          <p className="text-muted-foreground text-sm">
            Execute recurring subscription billing, generate draft invoices, and catch up due periods.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.refresh()}
            disabled={isRunning}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            onClick={() => setShowConfirm(true)}
            disabled={isRunning}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run Billing
          </Button>
        </div>
      </div>

      {latestRun && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-lg">Latest Run Overview</CardTitle>
                <CardDescription>
                  Run on {new Date(latestRun.runDate).toISOString().split('T')[0]} • Max{' '}
                  {latestRun.maxPeriodsPerSubscription} periods/sub
                </CardDescription>
              </div>
              <div>{getStatusBadge(latestRun.status)}</div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-center">
              <div className="bg-muted/50 p-3 rounded-lg border">
                <div className="text-2xl font-bold text-foreground">
                  {latestRun.invoicesGenerated}
                </div>
                <div className="text-xs text-muted-foreground">Invoices Generated</div>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  {latestRun.subscriptionsFullyProcessed}
                </div>
                <div className="text-xs text-emerald-600 dark:text-emerald-500">Fully Processed</div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {latestRun.subscriptionsPartiallyProcessed}
                </div>
                <div className="text-xs text-amber-600 dark:text-amber-500">Partially Processed</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/40 p-3 rounded-lg border">
                <div className="text-2xl font-bold text-gray-700 dark:text-gray-300">
                  {latestRun.subscriptionsSkipped}
                </div>
                <div className="text-xs text-muted-foreground">Skipped</div>
              </div>
              <div className="bg-rose-50 dark:bg-rose-950/30 p-3 rounded-lg border border-rose-200 dark:border-rose-800">
                <div className="text-2xl font-bold text-rose-700 dark:text-rose-400">
                  {latestRun.subscriptionsFailed}
                </div>
                <div className="text-xs text-rose-600 dark:text-rose-500">Failed</div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                  {latestRun.subscriptionsPending}
                </div>
                <div className="text-xs text-blue-600 dark:text-blue-500">Pending Remaining</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Billing Run History</CardTitle>
          <CardDescription>
            Audit record of every executed billing run and its processing outcomes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No billing runs recorded yet. Click "Run Billing" above to trigger a run.
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Run Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Invoices</TableHead>
                    <TableHead className="text-center">Full / Part / Skip / Fail / Pend</TableHead>
                    <TableHead>Started / Finished</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
                      <TableCell>{new Date(r.runDate).toISOString().split('T')[0]}</TableCell>
                      <TableCell>{getStatusBadge(r.status)}</TableCell>
                      <TableCell className="text-center font-semibold">
                        {r.invoicesGenerated}
                      </TableCell>
                      <TableCell className="text-center text-xs font-mono">
                        <span className="text-emerald-600">{r.subscriptionsFullyProcessed}</span> /{' '}
                        <span className="text-amber-600">{r.subscriptionsPartiallyProcessed}</span> /{' '}
                        <span className="text-gray-500">{r.subscriptionsSkipped}</span> /{' '}
                        <span className="text-rose-600">{r.subscriptionsFailed}</span> /{' '}
                        <span className="text-blue-600 font-bold">{r.subscriptionsPending}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div>{new Date(r.startedAt).toLocaleTimeString()}</div>
                        {r.finishedAt && (
                          <div className="text-[10px]">
                            Finished: {new Date(r.finishedAt).toLocaleTimeString()}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewDetails(r)}
                        >
                          <Eye className="h-4 w-4 mr-1" /> Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Billing Run</DialogTitle>
            <DialogDescription>
              This will evaluate all active subscriptions with due periods as of today,
              compute applicable line discounts, calculate single-rate GST taxes, and generate draft invoices.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground space-y-2">
            <p>
              • Billing creates exactly one invoice per subscription per billing period.
            </p>
            <p>
              • Subscriptions with multiple overdue cycles will catch up up to the configured limit (12 periods).
            </p>
            <p>
              • Concurrent runs are protected with atomic row-level locks.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleStartRun}
              disabled={isRunning}
            >
              Start Billing Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      <Dialog open={!!selectedRun} onOpenChange={(open) => !open && setSelectedRun(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Billing Run Details <span className="font-mono text-sm text-muted-foreground">({selectedRun?.id.slice(0, 8)})</span>
            </DialogTitle>
            <DialogDescription>
              Per-subscription processing outcomes and generated invoice breakdown.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 my-2">
            {isLoadingDetails ? (
              <div className="py-12 flex justify-center items-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : outcomes.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                No subscription outcomes logged for this run.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subscription</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-center">Invoices</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outcomes.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono font-medium text-xs">
                        {o.subscriptionNumber}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{o.customerName}</div>
                        <div className="text-[10px] text-muted-foreground">{o.customerEmail}</div>
                      </TableCell>
                      <TableCell>{getOutcomeBadge(o.outcome)}</TableCell>
                      <TableCell className="text-center font-bold">{o.invoicesGenerated}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {o.reason || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRun(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
