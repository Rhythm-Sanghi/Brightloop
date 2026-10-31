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
import { createTemplateAction } from '@/app/actions/catalog';
import { FileText, Plus, Loader2 } from 'lucide-react';

interface TemplateLine {
  id: string;
  productId: string;
  productName: string;
  variantId?: string | null;
  variantName?: string | null;
  quantity: number;
}

interface Template {
  id: string;
  name: string;
  planId: string;
  planName: string;
  validityDays: number;
  notes?: string | null;
  lines: TemplateLine[];
}

interface ProductOption {
  id: string;
  name: string;
  variants: { id: string; attribute: string; value: string }[];
}

export function TemplatesClient({
  initialTemplates,
  plans,
  products,
  canEdit,
}: {
  initialTemplates: Template[];
  plans: { id: string; name: string }[];
  products: ProductOption[];
  canEdit: boolean;
}) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form line state
  const [selectedProduct, setSelectedProduct] = useState(products[0]?.id || '');
  const [selectedVariant, setSelectedVariant] = useState('');
  const [quantity, setQuantity] = useState(1);

  const currentProd = products.find((p) => p.id === selectedProduct);

  async function handleCreateTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      planId: formData.get('planId') as string,
      validityDays: parseInt(formData.get('validityDays') as string, 10) || 30,
      notes: (formData.get('notes') as string) || undefined,
      lines: [
        {
          productId: selectedProduct,
          variantId: selectedVariant || undefined,
          quantity: quantity,
        },
      ],
    };

    try {
      const res = await createTemplateAction(data);
      if (res.success && res.data) {
        toast.success('Template created successfully');
        const plan = plans.find((p) => p.id === res.data.planId);
        setTemplates((prev) => [
          {
            id: res.data.id,
            name: res.data.name,
            planId: res.data.planId,
            planName: plan?.name || 'Standard Plan',
            validityDays: res.data.validityDays,
            notes: res.data.notes,
            lines: [
              {
                id: 'new_line',
                productId: selectedProduct,
                productName: currentProd?.name || 'Product',
                variantId: selectedVariant || null,
                variantName: currentProd?.variants.find((v) => v.id === selectedVariant)?.value || null,
                quantity,
              },
            ],
          },
          ...prev,
        ]);
        setOpen(false);
      } else {
        toast.error(res.error?.message || 'Failed to create template');
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
            Quotation Templates
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Pre-configured bundles with plans and default line items for quick quotation drafting.
          </p>
        </div>

        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-500 text-white font-medium">
                <Plus className="mr-2 h-4 w-4" /> Create Template
              </Button>
            </DialogTrigger>
            <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-white">Create Quotation Template</DialogTitle>
                <DialogDescription className="text-slate-400">
                  Configure default plan and pre-filled lines.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateTemplate} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-slate-300">Template Name</Label>
                  <Input id="name" name="name" placeholder="Enterprise ERP Bundle" required className="bg-slate-800 border-slate-700 text-white" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="planId" className="text-slate-300">Plan</Label>
                    <select
                      id="planId"
                      name="planId"
                      className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-white text-sm"
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="validityDays" className="text-slate-300">Validity (Days)</Label>
                    <Input id="validityDays" name="validityDays" type="number" defaultValue={30} min={1} required className="bg-slate-800 border-slate-700 text-white" />
                  </div>
                </div>

                {/* Pre-filled line */}
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Default Line Item</span>
                  <div className="space-y-2">
                    <Label className="text-slate-300">Product</Label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => { setSelectedProduct(e.target.value); setSelectedVariant(''); }}
                      className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-white text-sm"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  {currentProd && currentProd.variants.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-slate-300">Variant</Label>
                      <select
                        value={selectedVariant}
                        onChange={(e) => setSelectedVariant(e.target.value)}
                        className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-white text-sm"
                      >
                        <option value="">Standard (No variant)</option>
                        {currentProd.variants.map((v) => (
                          <option key={v.id} value={v.id}>{v.attribute}: {v.value}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-slate-300">Quantity</Label>
                    <Input
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
                      min={1}
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save Template
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
              <TableHead>Template Name</TableHead>
              <TableHead>Associated Plan</TableHead>
              <TableHead>Validity</TableHead>
              <TableHead>Pre-filled Lines</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id} className="border-slate-200 dark:border-slate-800">
                <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                  {t.name}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{t.planName}</Badge>
                </TableCell>
                <TableCell>{t.validityDays} days</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    {t.lines.map((l, idx) => (
                      <div key={idx} className="text-xs text-slate-600 dark:text-slate-400">
                        {l.quantity}× {l.productName} {l.variantName ? `(${l.variantName})` : ''}
                      </div>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
