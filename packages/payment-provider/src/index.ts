import { createHmac, timingSafeEqual } from 'crypto';

export interface InitResult { reference: string; authorizationUrl: string }
export interface WebhookEvent { eventId: string; type: string; reference: string; amountKobo: bigint; feeKobo: bigint }

/** Every gateway sits behind this; the API never imports vendor SDKs directly. */
export interface PaymentProvider {
  readonly name: string;
  initialize(a: { reference: string; amountKobo: bigint; email: string; callbackUrl?: string }): Promise<InitResult>;
  /** Verify signature over the RAW body (constant-time), then parse. null if invalid. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent | null;
  verify(reference: string): Promise<{ paid: boolean; amountKobo: bigint; feeKobo: bigint }>;
  /** Optional marketplace split: move a vendor's net earnings to their connected account. Idempotent per key. */
  transferToVendor?(a: { accountId: string; amountKobo: bigint; idempotencyKey: string; description?: string }): Promise<{ transferId: string }>;
}

export function hmacSha512(secret: string, body: Buffer | string): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8'), y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Paystack-like fee: 1.5% + NGN100 (only from NGN2500), capped NGN2000. Estimate used by FakeProvider. */
export function estimateFee(amountKobo: bigint): bigint {
  let fee = (amountKobo * 15n + 500n) / 1000n;
  if (amountKobo >= 250000n) fee += 10000n;
  return fee > 200000n ? 200000n : fee;
}

export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  constructor(private secret: string, private webhookSecret = secret, private base = 'https://api.paystack.co') {}
  private async call(path: string, init?: RequestInit) {
    const r = await fetch(this.base + path, { ...init, headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error(`paystack ${path} ${r.status}`);
    return (await r.json()) as any;
  }
  async initialize(a: { reference: string; amountKobo: bigint; email: string; callbackUrl?: string }) {
    const j = await this.call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({ reference: a.reference, amount: a.amountKobo.toString(), email: a.email, callback_url: a.callbackUrl }),
    });
    return { reference: a.reference, authorizationUrl: j.data.authorization_url as string };
  }
  parseWebhook(raw: Buffer, signature?: string): WebhookEvent | null {
    if (!signature || !safeEqualHex(hmacSha512(this.webhookSecret, raw), signature)) return null;
    const j = JSON.parse(raw.toString('utf8'));
    return {
      eventId: String(j.data?.id ?? j.event + ':' + j.data?.reference), type: j.event,
      reference: j.data?.reference, amountKobo: BigInt(j.data?.amount ?? 0), feeKobo: BigInt(j.data?.fees ?? 0),
    };
  }
  async verify(reference: string) {
    const j = await this.call('/transaction/verify/' + encodeURIComponent(reference));
    return { paid: j.data.status === 'success', amountKobo: BigInt(j.data.amount), feeKobo: BigInt(j.data.fees ?? 0) };
  }
}

/** Deterministic in-process provider for tests/dev: same signing scheme as Paystack, no network. */
export class FakeProvider implements PaymentProvider {
  readonly name = 'fake';
  constructor(private secret = 'fake-secret', private publicBase = 'http://localhost:3100') {}
  async initialize(a: { reference: string; amountKobo: bigint }) {
    return { reference: a.reference, authorizationUrl: `${this.publicBase}/pay/fake?reference=${encodeURIComponent(a.reference)}` };
  }
  parseWebhook(raw: Buffer, signature?: string): WebhookEvent | null {
    if (!signature || !safeEqualHex(hmacSha512(this.secret, raw), signature)) return null;
    const j = JSON.parse(raw.toString('utf8'));
    return { eventId: String(j.data.id), type: j.event, reference: j.data.reference, amountKobo: BigInt(j.data.amount), feeKobo: BigInt(j.data.fees) };
  }
  async verify() { return { paid: true, amountKobo: 0n, feeKobo: 0n }; }
  /** Test/dev helper: build a signed charge.success delivery. */
  buildChargeSuccess(a: { eventId: string; reference: string; amountKobo: bigint }) {
    const body = Buffer.from(JSON.stringify({
      event: 'charge.success',
      data: { id: a.eventId, reference: a.reference, amount: a.amountKobo.toString(), fees: estimateFee(a.amountKobo).toString() },
    }));
    return { body, signature: hmacSha512(this.secret, body) };
  }
}

/**
 * Stripe in TEST mode (sk_test_...), "separate charges and transfers" Connect model:
 * the customer pays the platform once (Checkout Session), the platform keeps its commission, and each vendor's
 * net earnings are transferred to the vendor's Express connected account when the payout run settles them.
 * Amounts stay integer minor units (1 kobo = 1 minor unit); STRIPE_CURRENCY picks the test account's currency.
 * Processing fee is reported as 0 from the webhook (the real fee lives on the balance transaction).
 */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
  constructor(private secret: string, private webhookSecret: string, private currency = 'usd', private base = 'https://api.stripe.com') {
    if (!secret.startsWith('sk_test_') && process.env.STRIPE_ALLOW_LIVE !== '1') throw new Error('StripeProvider only accepts test keys (sk_test_...)');
  }
  private async call(path: string, form?: Record<string, string>, idempotencyKey?: string) {
    const r = await fetch(this.base + path, {
      method: form ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.secret}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const j = (await r.json()) as any;
    if (!r.ok) throw new Error(`stripe ${path} ${r.status}: ${j?.error?.message ?? ''}`);
    return j;
  }
  async initialize(a: { reference: string; amountKobo: bigint; email: string; callbackUrl?: string }) {
    const back = a.callbackUrl ?? 'http://localhost:3100/orders';
    const j = await this.call('/v1/checkout/sessions', {
      mode: 'payment', client_reference_id: a.reference, customer_email: a.email, success_url: back, cancel_url: back,
      'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': this.currency,
      'line_items[0][price_data][unit_amount]': a.amountKobo.toString(),
      'line_items[0][price_data][product_data][name]': `Oja Market order ${a.reference.slice(0, 8)}`,
      'payment_intent_data[transfer_group]': a.reference, 'metadata[reference]': a.reference,
    }, `init:${a.reference}`);
    return { reference: a.reference, authorizationUrl: j.url as string };
  }
  /** Stripe-Signature: t=<unix>,v1=<hmac-sha256 of "t.body">; 5 minute tolerance against replay. */
  parseWebhook(raw: Buffer, signature?: string, nowSec = Math.floor(Date.now() / 1000)): WebhookEvent | null {
    if (!signature) return null;
    const parts = Object.fromEntries(signature.split(',').map((p) => p.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!t || Math.abs(nowSec - t) > 300) return null;
    const want = createHmac('sha256', this.webhookSecret).update(`${t}.`).update(raw).digest('hex');
    if (!parts.v1 || !safeEqualHex(want, parts.v1)) return null;
    const j = JSON.parse(raw.toString('utf8'));
    const o = j.data?.object ?? {};
    const paid = j.type === 'checkout.session.completed' && o.payment_status === 'paid';
    return { eventId: String(j.id), type: paid ? 'charge.success' : String(j.type), reference: o.client_reference_id ?? o.metadata?.reference ?? '', amountKobo: BigInt(o.amount_total ?? 0), feeKobo: 0n };
  }
  async verify(reference: string) {
    const j = await this.call('/v1/checkout/sessions?limit=1&client_reference_id=' + encodeURIComponent(reference));
    const s = j.data?.[0];
    return { paid: s?.payment_status === 'paid', amountKobo: BigInt(s?.amount_total ?? 0), feeKobo: 0n };
  }
  /** Vendor onboarding: Express connected account + hosted onboarding link. */
  async createConnectedAccount(email: string) {
    const j = await this.call('/v1/accounts', { type: 'express', email, 'capabilities[transfers][requested]': 'true' });
    return { accountId: j.id as string };
  }
  async onboardingLink(accountId: string, returnUrl: string) {
    const j = await this.call('/v1/account_links', { account: accountId, type: 'account_onboarding', return_url: returnUrl, refresh_url: returnUrl });
    return { url: j.url as string };
  }
  async transferToVendor(a: { accountId: string; amountKobo: bigint; idempotencyKey: string; description?: string }) {
    const j = await this.call('/v1/transfers', { amount: a.amountKobo.toString(), currency: this.currency, destination: a.accountId, description: a.description ?? 'Oja Market payout' }, a.idempotencyKey);
    return { transferId: j.id as string };
  }
}
