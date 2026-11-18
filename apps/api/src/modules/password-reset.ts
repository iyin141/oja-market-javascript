import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export const RESET_TTL_SEC = 30 * 60;
const PURPOSE = 'password-reset';
/** Key derived from the access secret, so a reset token can never be replayed as an access token (and vice versa). */
const keyOf = (secret: string) => createHmac('sha256', secret).update(PURPOSE).digest();
/** Fingerprint of the current password hash: the token dies the moment the password changes (single use). Keyed, so the claim reveals nothing about the hash. */
export const passwordFingerprint = (passwordHash: string, secret = config.jwtAccess) => createHmac('sha256', keyOf(secret)).update(passwordHash).digest('base64url').slice(0, 22);

export function signResetToken(user: { id: string; passwordHash: string }, secret = config.jwtAccess, nowSec = Math.floor(Date.now() / 1000)): string {
  return jwt.sign({ purpose: PURPOSE, fp: passwordFingerprint(user.passwordHash, secret), iat: nowSec }, keyOf(secret), { algorithm: 'HS256', subject: user.id, expiresIn: RESET_TTL_SEC });
}

/** Returns the user id and fingerprint, or null for anything bad (garbage, wrong purpose/key, expired). */
export function readResetToken(token: string, secret = config.jwtAccess, nowSec = Math.floor(Date.now() / 1000)): { userId: string; fp: string } | null {
  try {
    const p = jwt.verify(token, keyOf(secret), { algorithms: ['HS256'], clockTimestamp: nowSec }) as jwt.JwtPayload;
    if (p.purpose !== PURPOSE || !p.sub || typeof p.fp !== 'string') return null;
    return { userId: p.sub, fp: p.fp };
  } catch { return null; }
}

export const resetLink = (token: string, base = config.webBaseUrl) => `${base.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
