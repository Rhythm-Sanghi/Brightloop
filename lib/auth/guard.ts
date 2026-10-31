import { prisma } from '../db/prisma';
import { getSessionTokenFromCookies, verifySessionToken } from './session';
import { AppError } from '../errors';
import { Role } from '../constants';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  sessionVersion: number;
  customerId: string | null;
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const token = await getSessionTokenFromCookies();
  if (!token) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required.', 401);
  }

  const payload = await verifySessionToken(token);
  if (!payload) {
    throw new AppError('UNAUTHENTICATED', 'Invalid or expired session token.', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
      sessionVersion: true,
      customerId: true,
    },
  });

  if (!user || !user.isActive) {
    throw new AppError('UNAUTHENTICATED', 'User account is inactive or not found.', 401);
  }

  // Reject session if sessionVersion differs
  if (user.sessionVersion !== payload.sv) {
    throw new AppError('UNAUTHENTICATED', 'Session has expired or was revoked.', 401);
  }

  return user as AuthenticatedUser;
}

export function requireRole(user: AuthenticatedUser, ...allowedRoles: Role[]): void {
  if (!allowedRoles.includes(user.role)) {
    throw new AppError('FORBIDDEN', 'Insufficient permissions for this action.', 403);
  }
}

export function assertNoForcedPasswordChange(user: AuthenticatedUser): void {
  if (user.mustChangePassword) {
    throw new AppError('PASSWORD_CHANGE_REQUIRED', 'Password change required before performing this action.', 403);
  }
}

export async function requireSession(): Promise<AuthenticatedUser & { userId: string }> {
  const user = await requireUser();
  assertNoForcedPasswordChange(user);
  return { ...user, userId: user.id };
}

export async function requireStaffSession(): Promise<AuthenticatedUser & { userId: string }> {
  const session = await requireSession();
  if (session.role !== 'ADMIN' && session.role !== 'STAFF') {
    throw new AppError('FORBIDDEN', 'Staff or admin privileges required.', 403);
  }
  return session;
}

export async function requireCustomerSession(): Promise<AuthenticatedUser & { userId: string; customerId: string }> {
  const session = await requireSession();
  if (session.role !== 'CUSTOMER' || !session.customerId) {
    throw new AppError('FORBIDDEN', 'Customer privileges required.', 403);
  }
  return session as AuthenticatedUser & { userId: string; customerId: string };
}
