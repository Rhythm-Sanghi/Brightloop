'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { createPlanAction, togglePlanActiveAction } from '@/app/actions/catalog';
import { Layers, Plus, Loader2 } from 'lucide-react';
import { BILLING_PERIODS, BillingPeriod } from '@/lib/constants';

interface Plan {
  id: string;
  name: string;
  billingPeriod: string;
  billingInterval: number;
  minimumQuantity: number;
  availableFrom: string;
  availableUntil?: string | null;
  paymentTermsDays: number;
  autoCloseOnExpiry: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenewal: boolean;
  isActive: boolean;
}

export function PlansClient({ initialPlans, canEdit }: { initialPlans: Plan[]; canEdit: boolean }) {
  const [plans, setPlans] = useState<Plan[]>(initialPlans);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form states for boolean flags
  const [autoCloseOnExpiry, setAutoClose] = useState(true);
  const [allowEarlyClose, setAllowEarlyClose] = useState(false);
  const [allowPause, setAllowPause] = useState(true);
  const [allowRenewal, setAllowRenewal] = useState(true);

  async function handleCreatePlan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      billingPeriod: formData.get('billingPeriod') as BillingPeriod,
      billingInterval: parseInt(formData.get('billingInterval') as string, 10) || 1,
      minimumQuantity: parseInt(formData.get('minimumQuantity') as string, 10) || 1,
      availableFrom: formData.get('availableFrom') as string,
      availableUntil: (formData.get('availableUntil') as string) || undefined,
      paymentTermsDays: parseInt(formData.get('paymentTermsDays') as string, 10) || 15,
      autoCloseOnExpiry,
      allowEarlyClose,
      allowPause,
      allowRenewal,
    };

    try {
      const res = await createPlanAction(data);
      if (res.success && res.data) {
        toast.success('Plan created successfully');
        setPlans((prev) => [
          {
            id: res.data.id,
            name: res.data.name,
            billingPeriod: res.data.billingPeriod,
            billingInterval: res.data.billingInterval,
            minimumQuantity: res.data.minimumQuantity,
            availableFrom: new Date(res.data.availableFrom).toISOString().split('T')[0],
            availableUntil: res.data.availableUntil
              ? new Date(res.data.availableUntil).toISOString().split('T')[0]
              : null,
            paymentTermsDays: res.data.paymentTermsDays,
            autoCloseOnExpiry: res.data.autoCloseOnExpiry,
            allowEarlyClose: res.data.allowEarlyClose,
            allowPause: res.data.allowPause,
            allowRenewal: res.data.allowRenewal,
            isActive: res.data.isActive,
          },
          ...prev,
        ]);
        setOpen(false);
      } else {
        toast.error(res.error?.message || 'Failed to create plan');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleActive(p: Plan) {
    if (!canEdit) return;
    const next = !p.isActive;
    try {
      const res = await togglePlanActiveAction(p.id, next);
      if (res.success) {
        toast.success(`Plan ${next ? 'restored' : 'archived'}`);
        setPlans((prev) =>
          prev.map((item) => (item.id === p.id ? { ...item, isActive: next } : item))
        );
      } else {
        toast.error(res.error?.message || 'Failed to update status');
      }
    } catch {
      toast.error('An error occurred');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Subscription Plans
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure billing periods, intervals, minimum quantities, and lifecycle rule flags.
          </p>
        </div>

        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-500 text-white font-medium">
                <Plus className="mr-2 h-4 w-4" /> Create Plan
              </Button>
            </DialogTrigger>
            <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-white">Create Subscription Plan</DialogTitle>
                <DialogDescription className="text-slate-400">
                  Plans carry billing schedule and lifecycle rules. Prices snapshot from subscription lines.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreatePlan} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-slate-300">Plan Name</Label>
                  <Input id="name" name="name" placeholder="Monthly Standard" required className="bg-slate-800 border-slate-700 text-white" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="billingPeriod" className="text-slate-300">Billing Period</Label>
                    <select
                      id="billingPeriod"
                      name="billingPeriod"
                      className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-white text-sm"
                    >
                      {BILLING_PERIODS.map((bp) => (
                        <option key={bp} value={bp}>{bp}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billingInterval" className="text-slate-300">Interval (Multiplier)</Label>
                    <Input id="billingInterval" name="billingInterval" type="number" defaultValue={1} min={1} required className="bg-slate-800 border-slate-700 text-white" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="minimumQuantity" className="text-slate-300">Min Quantity</Label>
                    <Input id="minimumQuantity" name="minimumQuantity" type="number" defaultValue={1} min={1} required className="bg-slate-800 border-slate-700 text-white" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paymentTermsDays" className="text-slate-300">Payment Terms (Days)</Label>
                    <Input id="paymentTermsDays" name="paymentTermsDays" type="number" defaultValue={15} min={0} required className="bg-slate-800 border-slate-700 text-white" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="availableFrom" className="text-slate-300">Available From</Label>
                    <Input id="availableFrom" name="availableFrom" type="date" defaultValue="2025-01-01" required className="bg-slate-800 border-slate-700 text-white" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="availableUntil" className="text-slate-300">Available Until</Label>
                    <Input id="availableUntil" name="availableUntil" type="date" className="bg-slate-800 border-slate-700 text-white" />
                  </div>
                </div>

                {/* Rule Flags */}
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Lifecycle Rule Flags</span>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="autoClose" className="text-sm text-slate-300">Auto Close on Expiry</Label>
                    <Switch id="autoClose" checked={autoCloseOnExpiry} onCheckedChange={setAutoClose} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="earlyClose" className="text-sm text-slate-300">Allow Early Close</Label>
                    <Switch id="earlyClose" checked={allowEarlyClose} onCheckedChange={setAllowEarlyClose} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pause" className="text-sm text-slate-300">Allow Pause</Label>
                    <Switch id="pause" checked={allowPause} onCheckedChange={setAllowPause} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="renewal" className="text-sm text-slate-300">Allow Renewal</Label>
                    <Switch id="renewal" checked={allowRenewal} onCheckedChange={setAllowRenewal} />
                  </div>
                </div>

                <DialogFooter>
                  <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save Plan
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-800">
              <TableHead>Plan Name</TableHead>
              <TableHead>Cadence</TableHead>
              <TableHead>Min Qty</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead>Rule Flags</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((p) => (
              <TableRow key={p.id} className="border-slate-200 dark:border-slate-800">
                <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                  {p.name}
                </TableCell>
                <TableCell>
                  {p.billingPeriod} {p.billingInterval > 1 ? `(×${p.billingInterval})` : ''}
                </TableCell>
                <TableCell>{p.minimumQuantity}</TableCell>
                <TableCell>{p.paymentTermsDays} days</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {p.autoCloseOnExpiry && <Badge variant="secondary" className="text-[10px]">Auto-Close</Badge>}
                    {p.allowEarlyClose && <Badge variant="secondary" className="text-[10px]">Early-Close</Badge>}
                    {p.allowPause && <Badge variant="secondary" className="text-[10px]">Pause</Badge>}
                    {p.allowRenewal && <Badge variant="secondary" className="text-[10px]">Renewal</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={p.isActive ? 'default' : 'secondary'} className={p.isActive ? 'bg-emerald-600 text-white' : ''}>
                    {p.isActive ? 'Active' : 'Archived'}
                  </Badge>
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleActive(p)}
                      className="border-slate-200 dark:border-slate-700"
                    >
                      {p.isActive ? 'Archive' : 'Restore'}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
