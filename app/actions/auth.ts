'use server';

import { redirect } from 'next/navigation';
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  createStaffSchema,
} from '@/lib/validations/auth';
import {
  loginUser,
  registerCustomer,
  requestPasswordReset,
  resetPasswordWithToken,
  changeUserPassword,
  createStaffAccount,
  setStaffActive,
} from '@/lib/services/auth';
import { setSessionCookie, clearSessionCookie } from '@/lib/auth/session';
import {
  requireUser,
  requireRole,
  assertNoForcedPasswordChange,
} from '@/lib/auth/guard';
import { mapError } from '@/lib/errors';

export async function loginAction(formData: unknown) {
  try {
    const parsed = loginSchema.parse(formData);
    const result = await loginUser(parsed.email, parsed.password);
    await setSessionCookie(result.sessionPayload);

    if (result.user.mustChangePassword) {
      return { success: true, redirectUrl: '/change-password' };
    }

    if (result.user.role === 'CUSTOMER') {
      return { success: true, redirectUrl: '/portal/overview' };
    }
    return { success: true, redirectUrl: '/dashboard' };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function registerAction(formData: unknown) {
  try {
    const parsed = registerSchema.parse(formData);
    const result = await registerCustomer(parsed);
    await setSessionCookie(result.sessionPayload);
    return { success: true, redirectUrl: '/portal/overview' };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect('/login');
}

export async function forgotPasswordAction(formData: unknown) {
  try {
    const parsed = forgotPasswordSchema.parse(formData);
    const message = await requestPasswordReset(parsed.email);
    return { success: true, message };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function resetPasswordAction(formData: unknown) {
  try {
    const parsed = resetPasswordSchema.parse(formData);
    await resetPasswordWithToken(parsed.token, parsed.newPassword);
    return { success: true, redirectUrl: '/login' };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function changePasswordAction(formData: unknown) {
  try {
    const user = await requireUser();
    const parsed = changePasswordSchema.parse(formData);
    const newSessionPayload = await changeUserPassword(
      user.id,
      parsed.currentPassword,
      parsed.newPassword
    );
    // Same response issues new session cookie with incremented sessionVersion
    await setSessionCookie(newSessionPayload);

    const redirectUrl = user.role === 'CUSTOMER' ? '/portal/overview' : '/dashboard';
    return { success: true, redirectUrl };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function createStaffAction(formData: unknown) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    const parsed = createStaffSchema.parse(formData);
    const result = await createStaffAccount(user.id, parsed.name, parsed.email);
    return { success: true, data: result };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}

export async function toggleStaffActiveAction(staffUserId: string, isActive: boolean) {
  try {
    const user = await requireUser();
    requireRole(user, 'ADMIN');
    assertNoForcedPasswordChange(user);

    await setStaffActive(user.id, staffUserId, isActive);
    return { success: true };
  } catch (err) {
    const { response } = mapError(err);
    return { success: false, error: response.error };
  }
}
