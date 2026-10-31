'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Eye, Filter, CheckCircle2, Clock, AlertCircle, XCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface InvoiceListItem {
  id: string;
  number: string | null;
  status: string;
  isOverdue: boolean;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balance: string;
  customer: {
    id: string;
    name: string;
    email: string;
  };
  subscription: {
    id: string;
    number: string | null;
  };
}

interface InvoicesClientProps {
  initialInvoices: InvoiceListItem[];
}

export function InvoicesClient({ initialInvoices }: InvoicesClientProps) {
  const router = useRouter();
  const [filterTab, setFilterTab] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const filteredInvoices = useMemo(() => {
    return initialInvoices.filter((inv) => {
      // Tab filter
      if (filterTab === 'OVERDUE') {
        if (!inv.isOverdue) return false;
      } else if (filterTab !== 'ALL') {
        if (inv.status !== filterTab) return false;
      }

      // Search filter
      if (search.trim()) {
        const query = search.toLowerCase();
        const num = (inv.number || 'DRAFT').toLowerCase();
        const custName = inv.customer.name.toLowerCase();
        const custEmail = inv.customer.email.toLowerCase();
        const subNum = (inv.subscription.number || '').toLowerCase();
        if (
          !num.includes(query) &&
          !custName.includes(query) &&
          !custEmail.includes(query) &&
          !subNum.includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [initialInvoices, filterTab, search]);

  const getStatusBadge = (inv: InvoiceListItem) => {
    if (inv.status === 'DRAFT') {
      return (
        <Badge variant="outline" className="text-muted-foreground border-dashed">
          DRAFT
        </Badge>
      );
    }
    if (inv.status === 'PAID') {
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> PAID
        </Badge>
      );
    }
    if (inv.status === 'CANCELLED') {
      return (
        <Badge className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1">
          <XCircle className="h-3 w-3" /> CANCELLED
        </Badge>
      );
    }
    if (inv.isOverdue) {
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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground text-sm">
            View generated subscription invoices, track payment status, and record collections.
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        <Tabs value={filterTab} onValueChange={setFilterTab} className="w-full md:w-auto">
          <TabsList className="grid grid-cols-3 sm:grid-cols-6 w-full md:w-auto">
            <TabsTrigger value="ALL">All</TabsTrigger>
            <TabsTrigger value="DRAFT">Draft</TabsTrigger>
            <TabsTrigger value="CONFIRMED">Confirmed</TabsTrigger>
            <TabsTrigger value="PAID">Paid</TabsTrigger>
            <TabsTrigger value="OVERDUE">Overdue</TabsTrigger>
            <TabsTrigger value="CANCELLED">Cancelled</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full md:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search invoice, customer, sub..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredInvoices.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No invoices found matching the selected filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Subscription</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono font-medium">
                        {inv.number ? (
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="text-primary hover:underline"
                          >
                            {inv.number}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">
                            [DRAFT - No Number]
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{inv.customer.name}</div>
                        <div className="text-xs text-muted-foreground">{inv.customer.email}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/subscriptions/${inv.subscription.id}`}
                          className="hover:underline text-muted-foreground"
                        >
                          {inv.subscription.number || inv.subscription.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">{inv.issueDate}</TableCell>
                      <TableCell className="text-xs">
                        <span className={inv.isOverdue ? 'text-rose-600 font-semibold' : ''}>
                          {inv.dueDate}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ₹{parseFloat(inv.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {parseFloat(inv.balance) > 0 ? (
                          <span className="font-semibold text-rose-600">
                            ₹{parseFloat(inv.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">₹0.00</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{getStatusBadge(inv)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/invoices/${inv.id}`}>
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Link>
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
    </div>
  );
}
