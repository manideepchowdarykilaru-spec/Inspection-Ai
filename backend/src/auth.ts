import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@shared/types';

/**
 * Authentication primitives.
 *
 * Passwords are stored as salted scrypt hashes; sessions are HMAC-signed
 * bearer tokens carrying the user id, role and expiry. Both use Node's crypto
 * module only. A production deployment would sit behind the department's
 * single sign-on (NIC Parichay) and this module would verify its tokens instead.
 */

const SECRET = process.env.AUTH_SECRET ?? 'lm-inspect-development-secret';
if (!process.env.AUTH_SECRET) {
  console.warn('[auth] AUTH_SECRET is not set — using the development secret. Set it in the environment for any shared deployment.');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Six-digit one-time code, hashed like a password for storage. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export interface TokenPayload {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

const encode = (buf: Buffer) => buf.toString('base64url');

export function signToken(payload: TokenPayload): string {
  const body = encode(Buffer.from(JSON.stringify(payload)));
  const signature = encode(createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${signature}`;
}

export function verifyToken(token: string | undefined): TokenPayload | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = encode(createHmac('sha256', SECRET).update(body).digest());
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export type AuthedRequest = Request & { auth?: TokenPayload };

const PUBLIC_PATHS = [/^\/api\/health$/, /^\/api\/auth\//];

/** Every /api route except health and the auth routes needs a valid token. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/') || req.method === 'OPTIONS' || PUBLIC_PATHS.some((re) => re.test(req.path))) {
    return next();
  }
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sign in required.' });
    return;
  }
  req.auth = payload;
  next();
}

export function requireRole(role: UserRole) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.auth?.role !== role) {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }
    next();
  };
}
