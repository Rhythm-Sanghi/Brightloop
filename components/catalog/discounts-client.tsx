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
import { createDiscountAction, updateDiscountAction } from '@/app/actions/catalog';
import { Percent, Plus, Loader2, Edit2, ShieldAlert } from 'lucide-react';
import { DISCOUNT_KINDS, DISCOUNT_SCOPES, DiscountKind, DiscountScope } from '@/lib/constants';

interface Discount {
  id: string;
  name: string;
  kind: DiscountKind;
  value: string;
  scope: DiscountScope;
  minPurchaseAmount?: string | null;
  minQuantity?: number | null;
  startsOn: string;
  endsOn?: string | null;
  maxUses?: number | null;
  timesUsed: number;
  isActive: boolean;
  productIds: string[];
}

interface ProductItem {
  id: string;
  name: string;
}

export function DiscountsClient({
  initialDiscounts,
  products,
}: {
  initialDiscounts: Discount[];
  products: ProductItem[];
}) {
  const [discounts, setDiscounts] = useState<Discount[]>(initialDiscounts);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingDisc, setEditingDisc] = useState<Discount | null>(null);
  const [loading, setLoading] = useState(false);

  // Create form state
  const [kind, setKind] = useState<DiscountKind>('PERCENT');
  const [scope, setScope] = useState<DiscountScope>('SUBSCRIPTION');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      kind,
      value: formData.get('value') as string,
      scope,
      minPurchaseAmount: (formData.get('minPurchaseAmount') as string) || undefined,
      minQuantity: formData.get('minQuantity') ? parseInt(formData.get('minQuantity') as string, 10) : undefined,
      startsOn: formData.get('startsOn') as string,
      endsOn: (formData.get('endsOn') as string) || undefined,
      maxUses: formData.get('maxUses') ? parseInt(formData.get('maxUses') as string, 10) : undefined,
      productIds: scope === 'PRODUCT' ? selectedProductIds : undefined,
    };

    try {
      const res = await createDiscountAction(data);
      if (res.success && res.data) {
        toast.success('Discount created successfully');
        setDiscounts((prev) => [
          {
            id: res.data.id,
            name: res.data.name,
            kind: res.data.kind as DiscountKind,
            value: res.data.value.toString(),
            scope: res.data.scope as DiscountScope,
            minPurchaseAmount: res.data.minPurchaseAmount?.toString() || null,
            minQuantity: res.data.minQuantity || null,
            startsOn: new Date(res.data.startsOn).toISOString().split('T')[0],
            endsOn: res.data.endsOn ? new Date(res.data.endsOn).toISOString().split('T')[0] : null,
            maxUses: res.data.maxUses,
            timesUsed: res.data.timesUsed,
            isActive: res.data.isActive,
            productIds: selectedProductIds,
          },
          ...prev,
        ]);
        setCreateOpen(false);
      } else {
        toast.error(res.error?.message || 'Failed to create discount');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingDisc) return;
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const newScope = formData.get('scope') as DiscountScope;
    const data = {
      id: editingDisc.id,
      name: formData.get('name') as string,
      value: formData.get('value') as string,
      scope: newScope,
      minPurchaseAmount: (formData.get('minPurchaseAmount') as string) || undefined,
      minQuantity: formData.get('minQuantity') ? parseInt(formData.get('minQuantity') as string, 10) : undefined,
      startsOn: formData.get('startsOn') as string,
      endsOn: (formData.get('endsOn') as string) || undefined,
      maxUses: formData.get('maxUses') ? parseInt(formData.get('maxUses') as string, 10) : undefined,
      productIds: newScope === 'PRODUCT' ? selectedProductIds : [],
    };

    try {
      const res = await updateDiscountAction(data);
      if (res.success && res.data) {
        toast.success('Discount updated successfully');
        setDiscounts((prev) =>
          prev.map((d) =>
            d.id === editingDisc.id
              ? {
                  ...d,
                  name: res.data.name,
                  value: res.data.value.toString(),
                  scope: res.data.scope as DiscountScope,
                  minPurchaseAmount: res.data.minPurchaseAmount?.toString() || null,
                  minQuantity: res.data.minQuantity,
                  startsOn: new Date(res.data.startsOn).toISOString().split('T')[0],
                  endsOn: res.data.endsOn ? new Date(res.data.endsOn).toISOString().split('T')[0] : null,
                  maxUses: res.data.maxUses,
                  productIds: newScope === 'PRODUCT' ? selectedProductIds : [],
                }
              : d
          )
        );
        setEditOpen(false);
      } else {
        toast.error(res.error?.message || 'Failed to update discount');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleActive(d: Discount) {
    const next = !d.isActive;
    try {
      const res = await updateDiscountAction({ id: d.id, isActive: next });
      if (res.success) {
        toast.success(`Discount ${next ? 'activated' : 'deactivated'}`);
        setDiscounts((prev) =>
          prev.map((item) => (item.id === d.id ? { ...item, isActive: next } : item))
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
            Discounts & Promotions
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Define recurring discounts, minimum thresholds, date boundaries, and usage caps.
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-500 text-white font-medium">
              <Plus className="mr-2 h-4 w-4" /> Create Discount
            </Button>
          </DialogTrigger>
          <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-white">Create Discount</DialogTitle>
              <DialogDescription className="text-slate-400">
                Discounts apply automatically before GST. Values must be greater than zero.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-slate-300">Discount Name</Label>
                <Input id="name" name="name" placeholder="Early Bird 10% Off" required className="bg-slate-800 border-slate-700 text-white" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="kind" className="text-slate-300">Kind</Label>
                  <select
                    id="kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as DiscountKind)}
                    className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-white text-sm"
                  >
                    {DISCOUNT_KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="value" className="text-slate-300">
                    Value {kind === 'PERCENT' ? '(%)' : '(₹)'}
                  </Label>
                  <Input id="value" name="value" placeholder={kind === 'PERCENT' ? '10.00' : '100.00'} required className="bg-slate-800 border-slate-700 text-white" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scope" className="text-slate-300">Scope</Label>
                <select
                  id="scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as DiscountScope)}
                  className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-white text-sm"
                >
                  {DISCOUNT_SCOPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {scope === 'PRODUCT' && (
                <div className="space-y-2">
                  <Label className="text-slate-300">Applies to Products</Label>
                  <div className="max-h-32 overflow-y-auto space-y-1 p-2 rounded bg-slate-800/80 border border-slate-700">
                    {products.map((prod) => (
                      <label key={prod.id} className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(prod.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedProductIds((prev) => [...prev, prod.id]);
                            } else {
                              setSelectedProductIds((prev) => prev.filter((id) => id !== prod.id));
                            }
                          }}
                          className="rounded border-slate-700"
                        />
                        <span>{prod.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="minPurchaseAmount" className="text-slate-300">Min Purchase (₹)</Label>
                  <Input id="minPurchaseAmount" name="minPurchaseAmount" placeholder="Optional" className="bg-slate-800 border-slate-700 text-white" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minQuantity" className="text-slate-300">Min Line Quantity</Label>
                  <Input id="minQuantity" name="minQuantity" type="number" placeholder="Optional" className="bg-slate-800 border-slate-700 text-white" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startsOn" className="text-slate-300">Starts On</Label>
                  <Input id="startsOn" name="startsOn" type="date" defaultValue="2025-01-01" required className="bg-slate-800 border-slate-700 text-white" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endsOn" className="text-slate-300">Ends On</Label>
                  <Input id="endsOn" name="endsOn" type="date" className="bg-slate-800 border-slate-700 text-white" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxUses" className="text-slate-300">Maximum Uses</Label>
                <Input id="maxUses" name="maxUses" type="number" placeholder="Unlimited if empty" className="bg-slate-800 border-slate-700 text-white" />
              </div>

              <DialogFooter>
                <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white">
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create Discount
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Discount Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Discount: {editingDisc?.name}</DialogTitle>
            <DialogDescription className="text-slate-400">
              Scope changes are guarded against existing links and assignments.
            </DialogDescription>
          </DialogHeader>
          {editingDisc && (
            <form onSubmit={handleUpdate} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name" className="text-slate-300">Discount Name</Label>
                <Input id="edit-name" name="name" defaultValue={editingDisc.name} required className="bg-slate-800 border-slate-700 text-white" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Kind</Label>
                  <Input value={editingDisc.kind} readOnly className="bg-slate-800/40 border-slate-700 text-slate-400" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-value" className="text-slate-300">Value</Label>
                  <Input id="edit-value" name="value" defaultValue={editingDisc.value} required className="bg-slate-800 border-slate-700 text-white" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-scope" className="text-slate-300">Scope</Label>
                <select
                  id="edit-scope"
                  name="scope"
                  defaultValue={editingDisc.scope}
                  className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-white text-sm"
                >
                  {DISCOUNT_SCOPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <p className="text-xs text-amber-400/80">
                  Changing scope requires removing active links/assignments first.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-minPurchase" className="text-slate-300">Min Purchase (₹)</Label>
                  <Input id="edit-minPurchase" name="minPurchaseAmount" defaultValue={editingDisc.minPurchaseAmount || ''} className="bg-slate-800 border-slate-700 text-white" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-minQty" className="text-slate-300">Min Quantity</Label>
                  <Input id="edit-minQty" name="minQuantity" type="number" defaultValue={editingDisc.minQuantity || ''} className="bg-slate-800 border-slate-700 text-white" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-startsOn" className="text-slate-300">Starts On</Label>
                  <Input id="edit-startsOn" name="startsOn" type="date" defaultValue={editingDisc.startsOn} required className="bg-slate-800 border-slate-700 text-white" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-endsOn" className="text-slate-300">Ends On</Label>
                  <Input id="edit-endsOn" name="endsOn" type="date" defaultValue={editingDisc.endsOn || ''} className="bg-slate-800 border-slate-700 text-white" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-maxUses" className="text-slate-300">Max Uses</Label>
                <Input id="edit-maxUses" name="maxUses" type="number" defaultValue={editingDisc.maxUses || ''} className="bg-slate-800 border-slate-700 text-white" />
              </div>

              <DialogFooter>
                <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white">
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Update Discount
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-800">
              <TableHead>Discount Name</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Validity Window</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {discounts.map((d) => (
              <TableRow key={d.id} className="border-slate-200 dark:border-slate-800">
                <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                  {d.name}
                </TableCell>
                <TableCell>
                  {d.kind === 'PERCENT' ? `${d.value}%` : `₹${d.value}`}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{d.scope}</Badge>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">
                    {d.timesUsed} / {d.maxUses !== null ? d.maxUses : '∞'}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {d.startsOn} to {d.endsOn || 'Indefinite'}
                </TableCell>
                <TableCell>
                  <Badge variant={d.isActive ? 'default' : 'secondary'} className={d.isActive ? 'bg-emerald-600 text-white' : ''}>
                    {d.isActive ? 'Active' : 'Disabled'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingDisc(d);
                      setSelectedProductIds(d.productIds);
                      setEditOpen(true);
                    }}
                    className="h-8 px-2 text-slate-600 dark:text-slate-300"
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleActive(d)}
                    className="h-8 border-slate-200 dark:border-slate-700"
                  >
                    {d.isActive ? 'Disable' : 'Enable'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
