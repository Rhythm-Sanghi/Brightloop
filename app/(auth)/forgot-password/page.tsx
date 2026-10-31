'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { forgotPasswordAction } from '@/app/actions/auth';
import { Mail, Loader2, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = { email: formData.get('email') as string };

    try {
      const res = await forgotPasswordAction(data);
      if (res.success && res.message) {
        setSubmittedMessage(res.message);
        toast.success('Reset link placed in simulated outbox.');
      } else {
        toast.error(res.error?.message || 'Failed to request password reset');
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
          <div className="flex items-center space-x-2 pb-2">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">
              B
            </div>
            <span className="text-xl font-bold tracking-tight text-white">Brightloop</span>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-white">Reset Password</CardTitle>
          <CardDescription className="text-slate-400">
            Enter your email to receive a password reset link
          </CardDescription>
        </CardHeader>
        {submittedMessage ? (
          <CardContent className="space-y-4">
            <div className="rounded-md bg-blue-950/40 p-4 border border-blue-900/60 text-sm text-blue-200">
              <p className="font-semibold text-blue-100">Request Received</p>
              <p className="mt-1 text-slate-300">{submittedMessage}</p>
              <p className="mt-3 text-xs text-slate-400 italic">
                &ldquo;The application generates a password-reset email in its outbox. Email delivery is simulated for this hackathon; no real email is sent.&rdquo;
              </p>
            </div>
            <div className="text-xs text-slate-400">
              Administrators can view generated reset links in the <strong>Email Outbox</strong> panel.
            </div>
            <Link href="/login" className="block">
              <Button variant="outline" className="w-full border-slate-700 text-slate-200 hover:bg-slate-800">
                <ArrowLeft className="mr-2 h-4 w-4" /> Return to Sign In
              </Button>
            </Link>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="customer@brightloop.demo"
                    required
                    className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </Button>
              <div className="text-center text-sm text-slate-400">
                Remember your password?{' '}
                <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
                  Sign in
                </Link>
              </div>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
