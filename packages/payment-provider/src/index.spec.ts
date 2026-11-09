import { FakeProvider, PaystackProvider, hmacSha512 } from './index';
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
});
