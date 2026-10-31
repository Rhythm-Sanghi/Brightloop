'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { createTaxAction } from '@/app/actions/catalog';
import { Landmark, Plus, Loader2 } from 'lucide-react';

interface Tax {
  id: string;
  name: string;
  ratePercent: string;
  isActive: boolean;
}

export function TaxesClient({ initialTaxes }: { initialTaxes: Tax[] }) {
  const [taxes, setTaxes] = useState<Tax[]>(initialTaxes);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleCreateTax(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      ratePercent: formData.get('ratePercent') as string,
    };

    try {
      const res = await createTaxAction(data);
      if (res.success && res.data) {
        toast.success('Tax rate created successfully');
        setTaxes((prev) => [
          {
            id: res.data.id,
            name: res.data.name,
            ratePercent: res.data.ratePercent.toString(),
            isActive: res.data.isActive,
          },
          ...prev,
        ]);
        setOpen(false);
      } else {
        toast.error(res.error?.message || 'Failed to create tax');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Tax Rates (GST)
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage single GST rates applied per invoice line item.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-500 text-white font-medium">
              <Plus className="mr-2 h-4 w-4" /> Add Tax Rate
            </Button>
          </DialogTrigger>
          <DialogContent className="border-slate-800 bg-slate-900 text-slate-100">
            <DialogHeader>
              <DialogTitle className="text-white">Create Tax Rate</DialogTitle>
              <DialogDescription className="text-slate-400">
                Single rate per line (e.g. GST 18%).
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateTax} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-slate-300">Tax Name</Label>
                <Input id="name" name="name" placeholder="GST 18%" required className="bg-slate-800 border-slate-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ratePercent" className="text-slate-300">Rate Percentage (%)</Label>
                <Input id="ratePercent" name="ratePercent" placeholder="18.00" required className="bg-slate-800 border-slate-700 text-white" />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white">
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Tax Rate
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-800">
              <TableHead>Tax Name</TableHead>
              <TableHead>Rate (%)</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {taxes.map((t) => (
              <TableRow key={t.id} className="border-slate-200 dark:border-slate-800">
                <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                  {t.name}
                </TableCell>
                <TableCell className="font-mono">{t.ratePercent}%</TableCell>
                <TableCell>
                  <Badge variant={t.isActive ? 'default' : 'secondary'} className={t.isActive ? 'bg-emerald-600 text-white' : ''}>
                    {t.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
