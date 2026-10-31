import { requireCustomerSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
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

export default async function CustomerPaymentsPage() {
  const session = await requireCustomerSession();

  // Scoped to customer invoices
  const payments = await prisma.payment.findMany({
    where: {
      invoice: {
        customerId: session.customerId,
      },
    },
    orderBy: { paidOn: 'desc' },
    include: {
      invoice: {
        select: {
          id: true,
          number: true,
        },
      },
    },
  });

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
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Payments</h1>
        <p className="text-sm text-muted-foreground">
          Receipts and payment records credited towards your subscription invoices.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No payments recorded on your account yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment Date</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Payment Method</TableHead>
                    <TableHead>Reference / Note</TableHead>
                    <TableHead className="text-right">Amount Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs font-medium">
                        {new Date(p.paidOn).toISOString().split('T')[0]}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.invoice.number || 'INVOICE'}
                      </TableCell>
                      <TableCell>{getMethodBadge(p.method)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.note || '-'}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-emerald-700 dark:text-emerald-400">
                        ₹{parseFloat(p.amount.toString()).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
