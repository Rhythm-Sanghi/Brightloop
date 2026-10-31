import Link from 'next/link';
import { requireCustomerSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { todayBusinessDate } from '@/lib/dates/business-date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Eye, Printer, CheckCircle2, Clock, AlertCircle, XCircle } from 'lucide-react';
import Decimal from 'decimal.js';

export default async function CustomerInvoicesPage() {
  const session = await requireCustomerSession();
  const today = todayBusinessDate();

  // Strict customer isolation
  const invoices = await prisma.invoice.findMany({
    where: {
      customerId: session.customerId,
      status: { not: 'DRAFT' }, // Customers don't see internal draft invoices until confirmed
    },
    orderBy: { issueDate: 'desc' },
    include: {
      subscription: {
        select: { id: true, number: true },
      },
    },
  });

  const getStatusBadge = (inv: { status: string; isOverdue: boolean }) => {
    if (inv.status === 'PAID') {
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 w-fit">
          <CheckCircle2 className="h-3 w-3" /> PAID
        </Badge>
      );
    }
    if (inv.status === 'CANCELLED') {
      return (
        <Badge className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1 w-fit">
          <XCircle className="h-3 w-3" /> CANCELLED
        </Badge>
      );
    }
    if (inv.isOverdue) {
      return (
        <Badge className="bg-rose-500 hover:bg-rose-600 text-white flex items-center gap-1 w-fit">
          <AlertCircle className="h-3 w-3" /> OVERDUE
        </Badge>
      );
    }
    return (
      <Badge className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 w-fit">
        <Clock className="h-3 w-3" /> DUE
      </Badge>
    );
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Invoices</h1>
        <p className="text-sm text-muted-foreground">
          View your billing statements, payment status, and download printable tax invoices.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              You do not have any invoices issued yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Subscription</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => {
                    const totalDec = new Decimal(inv.total);
                    const paidDec = new Decimal(inv.amountPaid);
                    const balanceDec = totalDec.minus(paidDec);
                    const isOverdue =
                      inv.status === 'CONFIRMED' &&
                      new Date(inv.dueDate).getTime() < today.getTime() &&
                      balanceDec.greaterThan(0);

                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono font-medium">
                          {inv.number || 'INVOICE'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {inv.subscription.number || inv.subscription.id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(inv.issueDate).toISOString().split('T')[0]}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={isOverdue ? 'text-rose-600 font-semibold' : ''}>
                            {new Date(inv.dueDate).toISOString().split('T')[0]}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ₹{parseFloat(inv.total.toString()).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {balanceDec.greaterThan(0) ? (
                            <span className="font-bold text-rose-600">
                              ₹{balanceDec.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">₹0.00</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {getStatusBadge({ status: inv.status, isOverdue })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/invoices/${inv.id}/print`} target="_blank">
                              <Printer className="h-4 w-4 mr-1" /> View / Print
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
