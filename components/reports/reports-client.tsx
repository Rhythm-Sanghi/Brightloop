'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Calendar, Filter, FileSpreadsheet, ArrowUpRight, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface ReportInvoiceItem {
  id: string;
  number: string | null;
  customerName: string;
  customerEmail: string;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balance: string;
  status: string;
}

interface ReportsClientProps {
  initialFrom: string;
  initialTo: string;
  invoices: ReportInvoiceItem[];
  totals: {
    totalInvoiced: string;
    totalCollected: string;
    totalOutstanding: string;
    totalTax: string;
    totalDiscounts: string;
  };
}

export function ReportsClient({
  initialFrom,
  initialTo,
  invoices,
  totals,
}: ReportsClientProps) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const handleApplyFilter = () => {
    router.push(`/reports?from=${from}&to=${to}`);
  };

  const handleDownloadCsv = () => {
    window.location.href = `/api/reports/invoices?from=${from}&to=${to}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financial & Revenue Reports</h1>
          <p className="text-muted-foreground text-sm">
            Audited financial metrics directly reconciled with database records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="flex items-center gap-1.5"
            onClick={handleDownloadCsv}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Date Range Filter Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-end gap-4">
            <div className="space-y-1.5 flex-1">
              <label className="text-xs font-medium text-muted-foreground">From Date</label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 flex-1">
              <label className="text-xs font-medium text-muted-foreground">To Date</label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleApplyFilter}
            >
              <Filter className="h-4 w-4 mr-1.5" /> Apply Filter
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reconciled Financial KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total Invoiced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-foreground">
              ₹{parseFloat(totals.totalInvoiced).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Billed in date range</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Cash Collected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-emerald-600">
              ₹{parseFloat(totals.totalCollected).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Payments received</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Receivables
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-rose-600">
              ₹{parseFloat(totals.totalOutstanding).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Unpaid balance</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              GST Tax
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-foreground">
              ₹{parseFloat(totals.totalTax).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Single rate GST</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Discounts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
              ₹{parseFloat(totals.totalDiscounts).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Applied reductions</p>
          </CardContent>
        </Card>
      </div>

      {/* Itemized Reconciled Invoices Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices in Range</CardTitle>
          <CardDescription>
            {invoices.length} invoices generated between {from} and {to}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No invoices found in the selected date range.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">Discounts</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {inv.number || 'DRAFT'}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{inv.customerName}</div>
                        <div className="text-[10px] text-muted-foreground">{inv.customerEmail}</div>
                      </TableCell>
                      <TableCell className="text-xs">{inv.issueDate}</TableCell>
                      <TableCell className="text-right text-xs">
                        ₹{parseFloat(inv.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs text-emerald-600">
                        {parseFloat(inv.discountTotal) > 0
                          ? `-₹${parseFloat(inv.discountTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                          : '₹0.00'}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        ₹{parseFloat(inv.taxTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-xs">
                        ₹{parseFloat(inv.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs text-emerald-700">
                        ₹{parseFloat(inv.amountPaid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-rose-600">
                        ₹{parseFloat(inv.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {inv.status}
                        </Badge>
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
