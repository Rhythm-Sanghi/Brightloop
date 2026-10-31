import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/db/prisma';
import { hashPassword, hashToken, generateRandomToken } from '../../lib/auth/password';
import { resetPasswordWithToken } from '../../lib/services/auth';

describe('B11: Concurrent Password Reset Submissions', () => {
  let testUser: { id: string; email: string };
  const rawToken = generateRandomToken(32);

  beforeAll(async () => {
    // Create test user in brightloop_test
    const pwdHash = await hashPassword('Initial@123');
    testUser = await prisma.user.create({
      data: {
        name: 'B11 Test User',
        email: 'b11-test@brightloop.demo',
        passwordHash: pwdHash,
        role: 'CUSTOMER',
        sessionVersion: 0,
        resetTokenHash: hashToken(rawToken),
        resetTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 mins
      },
      select: { id: true, email: true },
    });
  });

  it('B11: exactly one concurrent submission succeeds, the other returns TOKEN_INVALID_OR_EXPIRED, sessionVersion incremented by 1', async () => {
    // Two concurrent submissions with the same raw token
    const p1 = resetPasswordWithToken(rawToken, 'NewPass1@abc');
    const p2 = resetPasswordWithToken(rawToken, 'NewPass2@abc');

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const error = rejected[0].reason;
    expect(error?.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    // Verify sessionVersion is incremented exactly once (0 -> 1)
    const updatedUser = await prisma.user.findUnique({
      where: { id: testUser.id },
    });

    expect(updatedUser?.sessionVersion).toBe(1);
    expect(updatedUser?.resetTokenHash).toBeNull();
    expect(updatedUser?.resetTokenExpiresAt).toBeNull();
  });
});
