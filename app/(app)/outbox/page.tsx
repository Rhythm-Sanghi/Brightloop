import { requireUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { redirect } from 'next/navigation';
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
import { Mail, AlertCircle, Info } from 'lucide-react';

export default async function OutboxPage() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  const emails = await prisma.emailOutbox.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center space-x-2">
          <Mail className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Simulated Email Outbox
          </h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Development inspection interface for system-generated outbound messages.
        </p>
      </div>

      <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-sm text-blue-800 dark:text-blue-200 flex items-start space-x-3">
        <Info className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">Simulated delivery: not sent.</p>
          <p className="text-xs text-blue-700 dark:text-blue-300">
            &ldquo;The application generates a password-reset email in its outbox. Email delivery is simulated for this hackathon; no real email is sent.&rdquo;
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-800">
              <TableHead>Delivery Status</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Body Payload</TableHead>
              <TableHead className="text-right">Placed At (UTC)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emails.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-slate-400">
                  Outbox is currently empty.
                </TableCell>
              </TableRow>
            ) : (
              emails.map((m) => (
                <TableRow key={m.id} className="border-slate-200 dark:border-slate-800">
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
                      Simulated delivery: not sent
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs font-mono">
                      {m.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                    {m.toAddress}
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300">
                    {m.subject}
                  </TableCell>
                  <TableCell className="max-w-md">
                    <pre className="text-xs font-mono bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800 whitespace-pre-wrap break-all text-slate-800 dark:text-slate-200">
                      {m.body}
                    </pre>
                  </TableCell>
                  <TableCell className="text-right text-xs text-slate-500 whitespace-nowrap">
                    {m.createdAt.toISOString().replace('T', ' ').substring(0, 19)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
