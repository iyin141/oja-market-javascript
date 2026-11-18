import { createHmac } from 'crypto';
import { FakeProvider, PaystackProvider, StripeProvider, hmacSha512, payableEmail } from './index';
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
    const p = new PaystackProvider('sk_test_k');
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 9, reference: 'x', amount: 100, fees: 1 } }));
    expect(p.parseWebhook(body, hmacSha512('sk_test_k', body))?.eventId).toBe('9');
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
  it('paystack: only test keys and supported currencies; webhook maps charge.success fields', () => {
    expect(() => new PaystackProvider('sk_live_x')).toThrow(/test keys/);
    expect(() => new PaystackProvider('sk_test_x', 'sk_test_x', 'EUR')).toThrow(/currency/);
    const p = new PaystackProvider('sk_test_x');
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 5, reference: 'ord-1', amount: 250000, fees: 4000, status: 'success' } }));
    expect(p.parseWebhook(body, hmacSha512('sk_test_x', body))).toMatchObject({ eventId: '5', type: 'charge.success', reference: 'ord-1', amountKobo: 250000n, feeKobo: 4000n });
  });
  it('paystack: calls the documented endpoints with integer amounts', async () => {
    const calls: { url: string; body?: any }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const data = url.includes('/transaction/initialize') ? { authorization_url: 'https://checkout.paystack.com/abc', reference: 'r' }
        : url.includes('/transferrecipient') ? { recipient_code: 'RCP_1' }
        : url.includes('/transfer') ? { transfer_code: 'TRF_1', status: 'success' }
        : url.includes('/bank/resolve') ? { account_name: 'ADA OBI' }
        : { status: 'success', amount: 250000, fees: 4000 };
      return new Response(JSON.stringify({ status: true, message: 'ok', data }), { status: 200 });
    }) as typeof fetch;
    try {
      const p = new PaystackProvider('sk_test_x');
      expect((await p.initialize({ reference: 'ord-1', amountKobo: 250000n, email: 'a@b.c' })).authorizationUrl).toContain('checkout.paystack.com');
      expect(calls[0].url).toBe('https://api.paystack.co/transaction/initialize');
      expect(calls[0].body).toMatchObject({ amount: 250000, currency: 'NGN', reference: 'ord-1' }); // number, not string
      expect(await p.verify('ord-1')).toEqual({ paid: true, failed: false, amountKobo: 250000n, feeKobo: 4000n });
      expect(calls[1].url).toBe('https://api.paystack.co/transaction/verify/ord-1');
      expect((await p.resolveAccount('0123456789', '058')).accountName).toBe('ADA OBI');
      expect(calls[2].url).toBe('https://api.paystack.co/bank/resolve?account_number=0123456789&bank_code=058');
      expect((await p.createRecipient({ name: 'ADA OBI', accountNumber: '0123456789', bankCode: '058' })).recipientCode).toBe('RCP_1');
      expect(calls[3].body).toMatchObject({ type: 'nuban', bank_code: '058', currency: 'NGN' });
      expect((await p.transferToVendor({ accountId: 'RCP_1', amountKobo: 90000n, idempotencyKey: 'payout:ABC-123' })).transferId).toBe('TRF_1');
      expect(calls[4].body).toMatchObject({ source: 'balance', amount: 90000, recipient: 'RCP_1' });
      expect(calls[4].body.reference).toMatch(/^[a-z0-9_-]{16,}$/);
    } finally { globalThis.fetch = orig; }
  });
  it('payableEmail rewrites reserved demo domains only', () => {
    expect(payableEmail('customer@oja.test')).toBe('customer@example.com');
    expect(payableEmail('a@learnly.local')).toBe('a@example.com');
    expect(payableEmail('real@gmail.com')).toBe('real@gmail.com');
  });
});
