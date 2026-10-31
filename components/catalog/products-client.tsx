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
import { createProductAction, addVariantAction, toggleProductActiveAction } from '@/app/actions/catalog';
import { PackagePlus, Plus, Loader2 } from 'lucide-react';

interface Variant {
  id: string;
  attribute: string;
  value: string;
  priceAdjustment: string;
}

interface Product {
  id: string;
  name: string;
  type: string;
  salesPrice: string;
  costPrice: string;
  isActive: boolean;
  defaultTax?: { name: string; ratePercent: string } | null;
  variants: Variant[];
}

interface ProductsClientProps {
  initialProducts: Product[];
  taxes: { id: string; name: string; ratePercent: string }[];
  canEdit: boolean;
}

export function ProductsClient({ initialProducts, taxes, canEdit }: ProductsClientProps) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreateProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      salesPrice: formData.get('salesPrice') as string,
      costPrice: formData.get('costPrice') as string,
      defaultTaxId: (formData.get('defaultTaxId') as string) || undefined,
    };

    try {
      const res = await createProductAction(data);
      if (res.success && res.data) {
        toast.success('Product created successfully');
        const tax = taxes.find((t) => t.id === res.data.defaultTaxId);
        setProducts((prev) => [
          {
            id: res.data.id,
            name: res.data.name,
            type: res.data.type,
            salesPrice: res.data.salesPrice.toString(),
            costPrice: res.data.costPrice.toString(),
            isActive: res.data.isActive,
            defaultTax: tax ? { name: tax.name, ratePercent: tax.ratePercent } : null,
            variants: [],
          },
          ...prev,
        ]);
        setProdModalOpen(false);
      } else {
        toast.error(res.error?.message || 'Failed to create product');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddVariant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedProductId) return;
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      productId: selectedProductId,
      attribute: formData.get('attribute') as string,
      value: formData.get('value') as string,
      priceAdjustment: formData.get('priceAdjustment') as string,
    };

    try {
      const res = await addVariantAction(data);
      if (res.success && res.data) {
        toast.success('Variant added successfully');
        setProducts((prev) =>
          prev.map((p) =>
            p.id === selectedProductId
              ? {
                  ...p,
                  variants: [
                    ...p.variants,
                    {
                      id: res.data.id,
                      attribute: res.data.attribute,
                      value: res.data.value,
                      priceAdjustment: res.data.priceAdjustment.toString(),
                    },
                  ],
                }
              : p
          )
        );
        setVariantModalOpen(false);
      } else {
        toast.error(res.error?.message || 'Failed to add variant');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleActive(p: Product) {
    if (!canEdit) return;
    const next = !p.isActive;
    try {
      const res = await toggleProductActiveAction(p.id, next);
      if (res.success) {
        toast.success(`Product ${next ? 'unarchived' : 'archived'}`);
        setProducts((prev) =>
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
            Products & Variants
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage subscription products, base pricing, default taxes, and price-adjusting variants.
          </p>
        </div>

        {canEdit && (
          <Dialog open={prodModalOpen} onOpenChange={setProdModalOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-500 text-white font-medium">
                <PackagePlus className="mr-2 h-4 w-4" /> Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="border-slate-800 bg-slate-900 text-slate-100">
              <DialogHeader>
                <DialogTitle className="text-white">Create New Product</DialogTitle>
                <DialogDescription className="text-slate-400">
                  Base prices are tax-exclusive snapshots.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateProduct} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-slate-300">Product Name</Label>
                  <Input id="name" name="name" placeholder="Brightloop Business Suite" required className="bg-slate-800 border-slate-700 text-white" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="salesPrice" className="text-slate-300">Sales Price (₹)</Label>
                    <Input id="salesPrice" name="salesPrice" placeholder="1000.00" required className="bg-slate-800 border-slate-700 text-white" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="costPrice" className="text-slate-300">Cost Price (₹)</Label>
                    <Input id="costPrice" name="costPrice" placeholder="400.00" required className="bg-slate-800 border-slate-700 text-white" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="defaultTaxId" className="text-slate-300">Default Tax</Label>
                  <select
                    id="defaultTaxId"
                    name="defaultTaxId"
                    className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-white text-sm"
                  >
                    <option value="">None (0%)</option>
                    {taxes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.ratePercent}%)
                      </option>
                    ))}
                  </select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save Product
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Add Variant Modal */}
      <Dialog open={variantModalOpen} onOpenChange={setVariantModalOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-white">Add Product Variant</DialogTitle>
            <DialogDescription className="text-slate-400">
              Variants adjust the base product price (e.g. Brand: Odoo +560).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddVariant} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="attribute" className="text-slate-300">Attribute</Label>
              <Input id="attribute" name="attribute" placeholder="Brand" required className="bg-slate-800 border-slate-700 text-white" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value" className="text-slate-300">Value</Label>
              <Input id="value" name="value" placeholder="Odoo" required className="bg-slate-800 border-slate-700 text-white" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="priceAdjustment" className="text-slate-300">Price Adjustment (₹)</Label>
              <Input id="priceAdjustment" name="priceAdjustment" placeholder="560.00" required className="bg-slate-800 border-slate-700 text-white" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Variant
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-800">
              <TableHead>Product</TableHead>
              <TableHead>Base Price</TableHead>
              <TableHead>Cost Price</TableHead>
              <TableHead>Default Tax</TableHead>
              <TableHead>Variants</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.id} className="border-slate-200 dark:border-slate-800">
                <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                  {p.name}
                </TableCell>
                <TableCell>₹{p.salesPrice}</TableCell>
                <TableCell className="text-slate-500">₹{p.costPrice}</TableCell>
                <TableCell>
                  {p.defaultTax ? (
                    <Badge variant="outline" className="text-xs">
                      {p.defaultTax.name} ({p.defaultTax.ratePercent}%)
                    </Badge>
                  ) : (
                    <span className="text-xs text-slate-400">None</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {p.variants.map((v) => (
                      <Badge key={v.id} variant="secondary" className="text-[11px]">
                        {v.attribute}: {v.value} (+₹{v.priceAdjustment})
                      </Badge>
                    ))}
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setSelectedProductId(p.id); setVariantModalOpen(true); }}
                        className="h-5 px-1.5 text-xs text-blue-600 hover:bg-blue-50"
                      >
                        <Plus className="h-3 w-3 mr-0.5" /> Variant
                      </Button>
                    )}
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
