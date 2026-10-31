'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, CreditCard, Banknote, ArrowUpRight, DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAYMENT_METHODS } from '@/lib/constants';

export interface PaymentListItem {
  id: string;
  amount: string;
  method: string;
  paidOn: string;
  note: string | null;
  recordedAt: string;
  recordedBy: {
    name: string;
  };
  invoice: {
    id: string;
    number: string | null;
    customer: {
      name: string;
      email: string;
    };
  };
}

interface PaymentsClientProps {
  initialPayments: PaymentListItem[];
  totalCollected: string;
}

export function PaymentsClient({ initialPayments, totalCollected }: PaymentsClientProps) {
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');

  const filteredPayments = useMemo(() => {
    return initialPayments.filter((p) => {
      if (methodFilter !== 'ALL' && p.method !== methodFilter) {
        return false;
      }

      if (search.trim()) {
        const query = search.toLowerCase();
        const invNum = (p.invoice.number || '').toLowerCase();
        const custName = p.invoice.customer.name.toLowerCase();
        const note = (p.note || '').toLowerCase();
        if (!invNum.includes(query) && !custName.includes(query) && !note.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [initialPayments, methodFilter, search]);

  const getMethodBadge = (method: string) => {
    switch (method) {
      case 'BANK_TRANSFER':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Bank Transfer</Badge>;
      case 'UPI':
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">UPI</Badge>;
      case 'CREDIT_CARD':
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Credit Card</Badge>;
      case 'CASH':
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Cash</Badge>;
      case 'CHEQUE':
        return <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">Cheque</Badge>;
      default:
        return <Badge variant="outline">{method}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground text-sm">
            Audit history of collections recorded against confirmed customer invoices.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Collections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              ₹{parseFloat(totalCollected).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Sum of all recorded payments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {initialPayments.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Payment records created</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Payment Methods
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {PAYMENT_METHODS.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Supported offline & direct methods</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
        <div className="flex items-center gap-2">
          <Select value={methodFilter} onValueChange={(val) => setMethodFilter(val || 'ALL')}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Methods" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Methods</SelectItem>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search invoice, customer, note..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* Payments Table */}
      <Card>
        <CardContent className="p-0">
          {filteredPayments.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No payments found matching the selected filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment Date</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Note / Ref</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs font-medium">{p.paidOn}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/invoices/${p.invoice.id}`}
                          className="text-primary hover:underline"
                        >
                          {p.invoice.number || 'DRAFT'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{p.invoice.customer.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.invoice.customer.email}
                        </div>
                      </TableCell>
                      <TableCell>{getMethodBadge(p.method)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.note || '-'}
                      </TableCell>
                      <TableCell className="text-xs">{p.recordedBy.name}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-700 dark:text-emerald-400">
                        ₹{parseFloat(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
