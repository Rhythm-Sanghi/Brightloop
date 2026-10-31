import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { SESSION_SECRET } from '../config';

const secretKey = new TextEncoder().encode(SESSION_SECRET);
const SESSION_COOKIE_NAME = 'session';
const SESSION_DURATION_SECONDS = 8 * 60 * 60; // 8 hours

export interface SessionPayload {
  sub: string; // userId
  sv: number;  // sessionVersion
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ sv: payload.sv })
    .setSubject(payload.sub)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secretKey);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });
    if (!payload.sub || typeof payload.sv !== 'number') {
      return null;
    }
    return {
      sub: payload.sub,
      sv: payload.sv,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function getSessionTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME);
  return cookie ? cookie.value : null;
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
