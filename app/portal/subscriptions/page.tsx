import Link from 'next/link';
import { requireCustomerSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
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
import { Eye, Clock, CheckCircle2, PauseCircle, XCircle } from 'lucide-react';

export default async function CustomerSubscriptionsPage() {
  const session = await requireCustomerSession();

  const subscriptions = await prisma.subscription.findMany({
    where: { customerId: session.customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      plan: true,
      lines: {
        include: { product: true },
      },
      requests: {
        where: { status: 'PENDING' },
      },
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 w-fit">
            <CheckCircle2 className="h-3 w-3" /> ACTIVE
          </Badge>
        );
      case 'PAUSED':
        return (
          <Badge className="bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1 w-fit">
            <PauseCircle className="h-3 w-3" /> PAUSED
          </Badge>
        );
      case 'CLOSED':
        return (
          <Badge className="bg-gray-600 hover:bg-gray-700 text-white flex items-center gap-1 w-fit">
            <XCircle className="h-3 w-3" /> CLOSED
          </Badge>
        );
      case 'DRAFT':
        return (
          <Badge variant="outline" className="border-dashed w-fit">
            QUOTATION
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Subscriptions</h1>
        <p className="text-sm text-muted-foreground">
          View your active plans, renewal dates, and submit change requests.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {subscriptions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              You do not have any active subscriptions or quotations yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subscription #</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Billing Frequency</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>Expiry Date</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-mono font-medium">
                        {sub.number || sub.id.slice(0, 8)}
                        {sub.requests.length > 0 && (
                          <span className="block text-[10px] text-amber-600 font-sans font-semibold">
                            Pending {sub.requests[0].requestType} Request
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{sub.plan.name}</TableCell>
                      <TableCell className="text-xs">
                        {sub.plan.billingInterval > 1 ? `Every ${sub.plan.billingInterval} ` : 'Every '}
                        {sub.plan.billingPeriod.toLowerCase()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(sub.startDate).toISOString().split('T')[0]}
                      </TableCell>
                      <TableCell className="text-xs">
                        {sub.expiryDate
                          ? new Date(sub.expiryDate).toISOString().split('T')[0]
                          : 'No expiry'}
                      </TableCell>
                      <TableCell className="text-center">{getStatusBadge(sub.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/portal/subscriptions/${sub.id}`}>
                            <Eye className="h-4 w-4 mr-1" /> View Details
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
