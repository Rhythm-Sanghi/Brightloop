'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { loginAction } from '@/app/actions/auth';
import { Lock, Mail, Loader2, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    };

    try {
      const res = await loginAction(data);
      if (res.success && res.redirectUrl) {
        toast.success('Signed in successfully');
        router.push(res.redirectUrl);
        router.refresh();
      } else {
        toast.error(res.error?.message || 'Invalid email or password');
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
          <CardTitle className="text-2xl font-bold tracking-tight text-white">Sign In</CardTitle>
          <CardDescription className="text-slate-400">
            Enter your credentials to access your account
          </CardDescription>
        </CardHeader>
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
                  placeholder="admin@brightloop.demo"
                  required
                  className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-slate-300">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="•••••••••"
                  required
                  className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="rounded-md bg-slate-800/40 p-3 border border-slate-800 text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Demo accounts (password: Demo@12345):</span>
              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                <li>admin@brightloop.demo (Admin)</li>
                <li>staff@brightloop.demo (Staff)</li>
                <li>customer@brightloop.demo (Customer)</li>
              </ul>
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...
                </>
              ) : (
                <>
                  Sign In <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <div className="text-center text-sm text-slate-400">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="text-blue-400 hover:text-blue-300 font-medium">
                Register as customer
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
