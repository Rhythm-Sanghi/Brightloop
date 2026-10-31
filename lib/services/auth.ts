import { prisma } from '../db/prisma';
import { normalizeEmail } from '../normalize';
import {
  hashPassword,
  verifyPassword,
  hashToken,
  generateRandomToken,
  generateTemporaryPassword,
} from '../auth/password';
import { checkRateLimit, recordFailedAttempt, clearRateLimit } from '../auth/rate-limiter';
import { AppError } from '../errors';
import { APP_BASE_URL } from '../config';
import { queueSimulatedEmail } from './outbox';
import { createAuditLog } from './audit';
import { Prisma } from '@prisma/client';

export async function loginUser(emailInput: string, passwordInput: string, clientIp = '127.0.0.1') {
  const email = normalizeEmail(emailInput);
  const ipKey = `ip:${clientIp}`;
  const emailKey = `email:${email}`;

  if (!checkRateLimit(ipKey).allowed || !checkRateLimit(emailKey).allowed) {
    throw new AppError('RATE_LIMITED', 'Too many failed login attempts. Please try again later.', 429);
  }

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: 'insensitive',
      },
    },
  });

  if (!user || !user.isActive) {
    recordFailedAttempt(ipKey);
    recordFailedAttempt(emailKey);
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  }

  const matches = await verifyPassword(passwordInput, user.passwordHash);
  if (!matches) {
    recordFailedAttempt(ipKey);
    recordFailedAttempt(emailKey);
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  }

  clearRateLimit(ipKey);
  clearRateLimit(emailKey);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      customerId: user.customerId,
    },
    sessionPayload: {
      sub: user.id,
      sv: user.sessionVersion,
    },
  };
}

export interface RegisterCustomerInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  company?: string;
  address?: string;
}

export async function registerCustomer(input: RegisterCustomerInput) {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (existingUser) {
        throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.', 409);
      }

      const existingCustomer = await tx.customer.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        include: { user: true },
      });

      if (existingCustomer) {
        if (existingCustomer.user) {
          throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.', 409);
        }

        // Link user to existing customer
        const user = await tx.user.create({
          data: {
            name: input.name,
            email,
            passwordHash,
            role: 'CUSTOMER',
            customerId: existingCustomer.id,
          },
        });

        await createAuditLog(
          {
            actorId: user.id,
            action: 'USER_REGISTERED',
            entityType: 'User',
            entityId: user.id,
            metadata: { linkedCustomerId: existingCustomer.id },
          },
          tx
        );

        return {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            mustChangePassword: user.mustChangePassword,
            customerId: user.customerId,
          },
          sessionPayload: {
            sub: user.id,
            sv: user.sessionVersion,
          },
        };
      }

      // Create new Customer and User together
      const customer = await tx.customer.create({
        data: {
          name: input.name,
          email,
          phone: input.phone || null,
          company: input.company || null,
          address: input.address || null,
        },
      });

      const user = await tx.user.create({
        data: {
          name: input.name,
          email,
          passwordHash,
          role: 'CUSTOMER',
          customerId: customer.id,
        },
      });

      await createAuditLog(
        {
          actorId: user.id,
          action: 'USER_REGISTERED',
          entityType: 'User',
          entityId: user.id,
          metadata: { newCustomerId: customer.id },
        },
        tx
      );

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
          customerId: user.customerId,
        },
        sessionPayload: {
          sub: user.id,
          sv: user.sessionVersion,
        },
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.', 409);
    }
    throw error;
  }
}

export async function requestPasswordReset(emailInput: string): Promise<string> {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  if (user && user.isActive) {
    const rawToken = generateRandomToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: expiresAt,
      },
    });

    const resetLink = `${APP_BASE_URL}/reset-password?token=${rawToken}`;
    await queueSimulatedEmail({
      toAddress: user.email,
      subject: 'Password Reset Request',
      body: `You requested a password reset for Brightloop. Use the following link to reset your password:\n\n${resetLink}\n\nThis link will expire in 30 minutes. Simulated delivery: not sent.`,
      kind: 'PASSWORD_RESET',
    });

    await createAuditLog({
      actorId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
    });
  }

  return 'If an account matches this address, a reset message has been placed in the simulated outbox.';
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(token);
  const newHash = await hashPassword(newPassword);

  const result = await prisma.$executeRaw(Prisma.sql`
    UPDATE "User"
    SET "passwordHash" = ${newHash},
        "resetTokenHash" = NULL,
        "resetTokenExpiresAt" = NULL,
        "passwordChangedAt" = now(),
        "mustChangePassword" = false,
        "sessionVersion" = "sessionVersion" + 1
    WHERE "resetTokenHash" = ${tokenHash}
      AND "resetTokenExpiresAt" > now()
  `);

  if (result !== 1) {
    throw new AppError('TOKEN_INVALID_OR_EXPIRED', 'Reset token is invalid or expired.', 400);
  }
}

export async function changeUserPassword(userId: string, currentPass: string, newPass: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found.', 404);
  }

  const matches = await verifyPassword(currentPass, user.passwordHash);
  if (!matches) {
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect current password.', 400);
  }

  const newHash = await hashPassword(newPass);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: newHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      sessionVersion: { increment: 1 },
    },
    select: {
      id: true,
      sessionVersion: true,
    },
  });

  await createAuditLog({
    actorId: userId,
    action: 'PASSWORD_CHANGED',
    entityType: 'User',
    entityId: userId,
  });

  return {
    sub: updated.id,
    sv: updated.sessionVersion,
  };
}

export async function createStaffAccount(adminUserId: string, name: string, emailInput: string) {
  const email = normalizeEmail(emailInput);
  const tempPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(tempPassword);

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (existing) {
    throw new AppError('EMAIL_TAKEN', 'A user with this email already exists.', 409);
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: 'STAFF',
      mustChangePassword: true,
    },
  });

  await queueSimulatedEmail({
    toAddress: email,
    subject: 'Welcome to Brightloop Staff',
    body: `Welcome to Brightloop, ${name}. Your staff account has been created. Please log in using the temporary password provided by your administrator. You will be prompted to change your password upon first login. Simulated delivery: not sent.`,
    kind: 'STAFF_WELCOME',
  });

  await createAuditLog({
    actorId: adminUserId,
    action: 'STAFF_CREATED',
    entityType: 'User',
    entityId: user.id,
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    temporaryPassword: tempPassword,
  };
}

export async function setStaffActive(adminUserId: string, staffUserId: string, isActive: boolean) {
  const target = await prisma.user.findUnique({ where: { id: staffUserId } });
  if (!target) {
    throw new AppError('NOT_FOUND', 'User not found.', 404);
  }

  const updated = await prisma.user.update({
    where: { id: staffUserId },
    data: {
      isActive,
      // If deactivating, increment sessionVersion to revoke active sessions
      ...(isActive ? {} : { sessionVersion: { increment: 1 } }),
    },
  });

  await createAuditLog({
    actorId: adminUserId,
    action: isActive ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED',
    entityType: 'User',
    entityId: target.id,
  });

  return updated;
}
