// Pure logic, no database or network: run with `jest --globalSetup= test/unit.spec.ts` when no Postgres is up.
import 'reflect-metadata';
import { RESET_TTL_SEC, passwordFingerprint, readResetToken, resetLink, signResetToken } from '../src/modules/password-reset';
import { payoutSkipReason } from '../src/modules/admin';
import { paymentCallbackUrl } from '../src/modules/checkout';
import { displayName } from '../src/modules/returns';
import { productionConfigProblems } from '../src/config';

const S = 'test-access-secret-0123456789';
const user = { id: '11111111-1111-1111-1111-111111111111', passwordHash: '$argon2id$old' };
const now = 1_800_000_000;

describe('password reset token', () => {
  it('round-trips for the user', () => {
    const t = signResetToken(user, S, now);
    expect(readResetToken(t, S, now + 10)).toEqual({ userId: user.id, fp: passwordFingerprint(user.passwordHash, S) });
  });
  it('expires after 30 minutes', () => {
    const t = signResetToken(user, S, now);
    expect(readResetToken(t, S, now + RESET_TTL_SEC - 1)).not.toBeNull();
    expect(readResetToken(t, S, now + RESET_TTL_SEC + 1)).toBeNull();
  });
  it('is single use: the fingerprint changes with the password hash', () => {
    const t = signResetToken(user, S, now);
    expect(readResetToken(t, S, now)!.fp).not.toBe(passwordFingerprint('$argon2id$new', S));
  });
  it('rejects garbage, a wrong secret and an access token', () => {
    expect(readResetToken('nope', S, now)).toBeNull();
    expect(readResetToken(signResetToken(user, S, now), 'other-secret', now)).toBeNull();
    const jwt = require('jsonwebtoken');
    expect(readResetToken(jwt.sign({ purpose: 'password-reset', fp: 'x' }, S, { subject: user.id }), S)).toBeNull(); // signed with the raw secret, not the derived key
  });
  it('builds the link under the base path', () => {
    expect(resetLink('a b', 'https://h/oja-market-js/')).toBe('https://h/oja-market-js/reset-password?token=a%20b');
  });
});

describe('payout skip logic', () => {
  it('skips without a recipient or a transfer-capable provider, never settles silently', () => {
    expect(payoutSkipReason(null, true)).toBe('no payout recipient');
    expect(payoutSkipReason('', true)).toBe('no payout recipient');
    expect(payoutSkipReason('RCP_1', false)).toBe('payment provider cannot transfer');
    expect(payoutSkipReason('RCP_1', true)).toBeNull();
  });
});

describe('callback url', () => {
  it('is base + /orders?reference=', () => {
    expect(paymentCallbackUrl('abc', 'https://h/oja-market-js')).toBe('https://h/oja-market-js/orders?reference=abc');
    expect(paymentCallbackUrl('abc', 'http://localhost:3100/')).toBe('http://localhost:3100/orders?reference=abc');
  });
});

describe('review author name', () => {
  it('first name plus initial only', () => {
    expect(displayName('Ada Obi')).toBe('Ada O.');
    expect(displayName('Ada')).toBe('Ada');
    expect(displayName('  ')).toBe('Customer');
  });
});

describe('production config guard', () => {
  const ok = { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'b', PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk' };
  it('passes a complete production env and ignores non-production', () => {
    expect(productionConfigProblems(ok)).toEqual([]);
    expect(productionConfigProblems({})).toEqual([]);
  });
  it('names the variables, never the values', () => {
    const p = productionConfigProblems({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'dev-access-secret-change-me-0123456789', PAYMENT_PROVIDER: 'paystack' }).join(' ');
    expect(p).toMatch(/JWT_ACCESS_SECRET/); expect(p).toMatch(/JWT_REFRESH_SECRET/); expect(p).toMatch(/PAYSTACK_SECRET_KEY/);
    expect(p).not.toMatch(/change-me/);
    expect(productionConfigProblems({ ...ok, PAYMENT_PROVIDER: 'fake' }).join()).toMatch(/PAYMENT_PROVIDER/);
  });
});
