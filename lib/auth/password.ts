import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateTemporaryPassword(): string {
  // 12 characters satisfying policy: min 9, 1 uppercase, 1 lowercase, 1 special, digits
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const specials = '!@#$%^&*()_+~';

  const u = upper[crypto.randomInt(upper.length)];
  const l = lower[crypto.randomInt(lower.length)];
  const d = digits[crypto.randomInt(digits.length)];
  const s = specials[crypto.randomInt(specials.length)];

  const all = upper + lower + digits + specials;
  let rest = '';
  for (let i = 0; i < 8; i++) {
    rest += all[crypto.randomInt(all.length)];
  }

  // Shuffle
  const chars = (u + l + d + s + rest).split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
