import { createHmac } from 'crypto';
import { FakeProvider, PaystackProvider, StripeProvider, hmacSha512 } from './index';
describe('providers', () => {
  const f = new FakeProvider('s');
  it('accepts valid signature', () => {
    const { body, signature } = f.buildChargeSuccess({ eventId: '1', reference: 'r', amountKobo: 500000n });
    const ev = f.parseWebhook(body, signature)!;
    expect(ev.reference).toBe('r');
    expect(ev.amountKobo).toBe(500000n);
    expect(ev.feeKobo).toBe(17500n);
  });
  it('rejects tampered body / bad / missing signature', () => {
    const { body, signature } = f.buildChargeSuccess({ eventId: '1', reference: 'r', amountKobo: 500000n });
    expect(f.parseWebhook(Buffer.from(body.toString().replace('500000', '1')), signature)).toBeNull();
    expect(f.parseWebhook(body, 'deadbeef')).toBeNull();
    expect(f.parseWebhook(body, undefined)).toBeNull();
  });
  it('paystack signs with sha512 hex', () => {
    const p = new PaystackProvider('sk');
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 9, reference: 'x', amount: 100, fees: 1 } }));
    expect(p.parseWebhook(body, hmacSha512('sk', body))?.eventId).toBe('9');
    expect(p.parseWebhook(body, hmacSha512('other', body))).toBeNull();
  });
  it('stripe: verifies t/v1 signature, maps paid checkout to charge.success, rejects replay and tampering', () => {
    const sp = new StripeProvider('sk_test_x', 'whsec_x');
    const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: 'ord-1', amount_total: 250000, payment_status: 'paid' } } }));
    const t = 1_700_000_000;
    const sig = (b: Buffer, ts = t) => `t=${ts},v1=${createHmac('sha256', 'whsec_x').update(`${ts}.`).update(b).digest('hex')}`;
    expect(sp.parseWebhook(body, sig(body), t + 10)).toMatchObject({ eventId: 'evt_1', type: 'charge.success', reference: 'ord-1', amountKobo: 250000n });
    expect(sp.parseWebhook(body, sig(body), t + 301)).toBeNull();
    expect(sp.parseWebhook(Buffer.from(body.toString().replace('250000', '1')), sig(body), t)).toBeNull();
    expect(sp.parseWebhook(body, undefined, t)).toBeNull();
  });
  it('stripe: refuses live keys', () => {
    expect(() => new StripeProvider('sk_live_x', 'w')).toThrow(/test keys/);
  });
});
