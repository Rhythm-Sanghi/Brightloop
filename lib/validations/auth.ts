import { z } from 'zod';
import { normalizeEmail } from '../normalize';

// At least 9 characters, with at least one uppercase letter, one lowercase letter, and one special character.
export const passwordSchema = z
  .string()
  .min(9, 'Password must be at least 9 characters long.')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter.')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter.')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character.');

export const loginSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(1, 'Password is required.'),
});

export const registerSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email().transform(normalizeEmail),
  password: passwordSchema,
  phone: z.string().optional(),
  company: z.string().optional(),
  address: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required.'),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: passwordSchema,
});

export const createStaffSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email().transform(normalizeEmail),
});
