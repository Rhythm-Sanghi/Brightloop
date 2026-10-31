'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { resetPasswordAction } from '@/app/actions/auth';
import { Lock, Loader2, ArrowRight } from 'lucide-react';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const newPassword = formData.get('newPassword') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      const res = await resetPasswordAction({ token, newPassword });
      if (res.success && res.redirectUrl) {
        toast.success('Password reset successfully. Please log in with your new password.');
        router.push(res.redirectUrl);
      } else {
        toast.error(res.error?.message || 'Invalid or expired reset token');
      }
    } catch {
      toast.error('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md border-slate-800 bg-slate-900/90 text-slate-100 shadow-2xl backdrop-blur">
      <CardHeader className="space-y-1">
        <div className="flex items-center space-x-2 pb-2">
          <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">
            B
          </div>
          <span className="text-xl font-bold tracking-tight text-white">Brightloop</span>
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight text-white">Set New Password</CardTitle>
        <CardDescription className="text-slate-400">
          Enter your new password below
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token" className="text-slate-300">Reset Token</Label>
            <Input
              id="token"
              name="token"
              value={token}
              readOnly
              className="bg-slate-800/40 border-slate-700 text-slate-400 font-mono text-xs"
            />
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
            <Label htmlFor="confirmPassword" className="text-slate-300">Confirm Password</Label>
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
        <CardFooter className="flex flex-col space-y-4">
          <Button
            type="submit"
            disabled={loading || !token}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...
              </>
            ) : (
              <>
                Update Password <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          <div className="text-center text-sm text-slate-400">
            <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
              Return to Sign In
            </Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <Suspense fallback={<div className="text-slate-400">Loading form...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
