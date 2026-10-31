'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { User, Lock, Mail, Building, Phone, MapPin, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { changePasswordAction } from '@/app/actions/auth';

interface CustomerProfileProps {
  user: {
    id: string;
    name: string;
    email: string;
    customer?: {
      companyName: string | null;
      phone: string | null;
      address: string | null;
    } | null;
  };
}

export function CustomerProfileClient({ user }: CustomerProfileProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error('New password and confirm password do not match.');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Updating password...');

    try {
      const formData = new FormData();
      formData.append('currentPassword', currentPassword);
      formData.append('newPassword', newPassword);
      formData.append('confirmPassword', confirmPassword);

      const res = await changePasswordAction(formData);
      if (res.success) {
        toast.success('Password updated successfully!', { id: toastId });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const errorVal = (res as { error?: { message?: string } | string }).error;
        const errMsg = typeof errorVal === 'string' ? errorVal : errorVal?.message || 'Failed to update password';
        toast.error(errMsg, { id: toastId });
      }
    } catch {
      toast.error('Unexpected error updating password', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Profile</h1>
        <p className="text-sm text-muted-foreground">
          View your account details and manage your security credentials.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Account Details Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-primary" /> Account Information
            </CardTitle>
            <CardDescription>Your registered customer account details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">Full Name</Label>
              <div className="font-medium text-foreground mt-0.5">{user.name}</div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Email Address</Label>
              <div className="font-medium text-foreground mt-0.5 flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {user.email}
              </div>
            </div>

            {user.customer?.companyName && (
              <div>
                <Label className="text-xs text-muted-foreground">Company Name</Label>
                <div className="font-medium text-foreground mt-0.5 flex items-center gap-1.5">
                  <Building className="h-3.5 w-3.5 text-muted-foreground" />
                  {user.customer.companyName}
                </div>
              </div>
            )}

            {user.customer?.phone && (
              <div>
                <Label className="text-xs text-muted-foreground">Phone Number</Label>
                <div className="font-medium text-foreground mt-0.5 flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {user.customer.phone}
                </div>
              </div>
            )}

            {user.customer?.address && (
              <div>
                <Label className="text-xs text-muted-foreground">Billing Address</Label>
                <div className="font-medium text-foreground mt-0.5 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {user.customer.address}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Change Password Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary" /> Security & Password
            </CardTitle>
            <CardDescription>Update your login password regularly for account security.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="current-pwd">Current Password</Label>
                <Input
                  id="current-pwd"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-pwd">New Password</Label>
                <Input
                  id="new-pwd"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 chars, 1 upper, 1 lower, 1 digit, 1 symbol"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-pwd">Confirm New Password</Label>
                <Input
                  id="confirm-pwd"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Update Password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
