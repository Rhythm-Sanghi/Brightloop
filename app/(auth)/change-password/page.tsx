'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { changePasswordAction, logoutAction } from '@/app/actions/auth';
import { Lock, Loader2, ArrowRight, ShieldAlert } from 'lucide-react';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const currentPassword = formData.get('currentPassword') as string;
    const newPassword = formData.get('newPassword') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      const res = await changePasswordAction({ currentPassword, newPassword });
      if (res.success && res.redirectUrl) {
        toast.success('Password changed successfully.');
        router.push(res.redirectUrl);
        router.refresh();
      } else {
        toast.error(res.error?.message || 'Failed to change password');
      }
    } catch {
      toast.error('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900/90 text-slate-100 shadow-2xl backdrop-blur">
        <CardHeader className="space-y-1">
          <div className="flex items-center space-x-2 text-amber-400 pb-1">
            <ShieldAlert className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-wide uppercase">Security Notice</span>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-white">Change Password</CardTitle>
          <CardDescription className="text-slate-400">
            Please update your password to continue using Brightloop.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword" className="text-slate-300">Current Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  id="currentPassword"
                  name="currentPassword"
                  type="password"
                  placeholder="•••••••••"
                  required
                  className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-slate-300">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  placeholder="•••••••••"
                  required
                  className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500"
                />
              </div>
              <p className="text-xs text-slate-500">
                Min 9 chars, 1 uppercase, 1 lowercase, 1 special character.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-300">Confirm New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="•••••••••"
                  required
                  className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500"
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-3">
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...
                </>
              ) : (
                <>
                  Change Password <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => logoutAction()}
              className="w-full text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            >
              Sign out instead
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
