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
import { createStaffAction, toggleStaffActiveAction } from '@/app/actions/auth';
import { UserPlus, Key, ShieldCheck, ShieldAlert, Loader2, Copy } from 'lucide-react';

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export function StaffClient({ initialStaff }: { initialStaff: StaffUser[] }) {
  const [staff, setStaff] = useState<StaffUser[]>(initialStaff);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function handleCreateStaff(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;

    try {
      const res = await createStaffAction({ name, email });
      if (res.success && res.data) {
        setTempPassword(res.data.temporaryPassword);
        toast.success('Staff account created.');
        setStaff((prev) => [
          {
            id: res.data.id,
            name: res.data.name,
            email: res.data.email,
            role: 'STAFF',
            isActive: true,
            mustChangePassword: true,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      } else {
        toast.error(res.error?.message || 'Failed to create staff account');
      }
    } catch {
      toast.error('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleActive(user: StaffUser) {
    const nextState = !user.isActive;
    try {
      const res = await toggleStaffActiveAction(user.id, nextState);
      if (res.success) {
        toast.success(`Staff account ${nextState ? 'activated' : 'deactivated'}.`);
        setStaff((prev) =>
          prev.map((s) => (s.id === user.id ? { ...s, isActive: nextState } : s))
        );
      } else {
        toast.error(res.error?.message || 'Action failed');
      }
    } catch {
      toast.error('An error occurred.');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Staff Team Management
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Create and manage staff accounts. Password change is enforced on first login.
          </p>
        </div>

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setTempPassword(null); }}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-500 text-white font-medium">
              <UserPlus className="mr-2 h-4 w-4" /> Add Staff Member
            </Button>
          </DialogTrigger>
          <DialogContent className="border-slate-800 bg-slate-900 text-slate-100">
            <DialogHeader>
              <DialogTitle className="text-white">Create Staff Account</DialogTitle>
              <DialogDescription className="text-slate-400">
                A cryptographically random 12-character temporary password will be generated.
              </DialogDescription>
            </DialogHeader>

            {tempPassword ? (
              <div className="space-y-4 py-4">
                <div className="p-4 rounded-lg bg-amber-950/40 border border-amber-900/60 text-amber-200 space-y-2">
                  <div className="flex items-center space-x-2 font-semibold">
                    <Key className="h-4 w-4" />
                    <span>Temporary Password (Shown Once)</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-black/40 border border-amber-800/60 font-mono text-base text-white">
                    <span>{tempPassword}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(tempPassword)}
                      className="text-amber-300 hover:text-white"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-amber-300/80">
                    Provide this password securely to the staff member. They will be required to change it immediately upon login.
                  </p>
                </div>
                <DialogFooter>
                  <Button onClick={() => setOpen(false)} className="w-full bg-slate-800 hover:bg-slate-700 text-white">
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <form onSubmit={handleCreateStaff} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-slate-300">Staff Full Name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Jane Staff"
                    required
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-300">Staff Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="jane@brightloop.demo"
                    required
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Generate Account
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-800">
              <TableHead>Staff Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Account Status</TableHead>
              <TableHead>Password Status</TableHead>
              <TableHead>Created Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((s) => (
              <TableRow key={s.id} className="border-slate-200 dark:border-slate-800">
                <TableCell>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.email}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{s.role}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={s.isActive ? 'default' : 'secondary'}
                    className={s.isActive ? 'bg-emerald-600 text-white' : 'bg-slate-600 text-white'}
                  >
                    {s.isActive ? 'Active' : 'Deactivated'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {s.mustChangePassword ? (
                    <span className="text-xs text-amber-500 font-medium">Pending Change</span>
                  ) : (
                    <span className="text-xs text-emerald-500 font-medium">Active</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {new Date(s.createdAt).toISOString().split('T')[0]}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleActive(s)}
                    className="border-slate-200 dark:border-slate-700"
                  >
                    {s.isActive ? 'Deactivate' : 'Reactivate'}
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
