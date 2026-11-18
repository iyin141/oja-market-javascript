import { createHmac, timingSafeEqual } from 'crypto';

export interface InitResult { reference: string; authorizationUrl: string }
export interface WebhookEvent { eventId: string; type: string; reference: string; amountKobo: bigint; feeKobo: bigint }

/** Every gateway sits behind this; the API never imports vendor SDKs directly. */
export interface PaymentProvider {
  readonly name: string;
  initialize(a: { reference: string; amountKobo: bigint; email: string; callbackUrl?: string }): Promise<InitResult>;
  /** Verify signature over the RAW body (constant-time), then parse. null if invalid. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent | null;
  verify(reference: string): Promise<{ paid: boolean; amountKobo: bigint; feeKobo: bigint; failed?: boolean }>;
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

/**
 * Paystack, https://api.paystack.co (endpoints from Paystack's OpenAPI spec):
 *  POST /transaction/initialize   {email, amount (integer, smallest unit), currency, reference, callback_url, metadata}
 *  GET  /transaction/verify/{reference}
 *  POST /transferrecipient        {type: "nuban", name, account_number, bank_code, currency}  -> data.recipient_code
 *  POST /transfer                 {source: "balance", amount, recipient, reference, reason}   -> data.status, data.transfer_code
 *  GET  /bank?country=&currency=   and   GET /bank/resolve?account_number=&bank_code=
 * Webhook: header x-paystack-signature = hex HMAC-SHA512 of the raw body keyed with the secret key; retried by Paystack until a 2xx.
 * Test keys only (sk_test_...) unless PAYSTACK_ALLOW_LIVE=1.
 */
/** Paystack validates the TLD, so seed/demo addresses on reserved domains (.test, .local, .invalid, .localhost, .example) are sent as example.com. Real customer emails are untouched. */
export const payableEmail = (email: string) => (/\.(test|local|invalid|localhost|example)$/i.test(email) ? `${email.split('@')[0]}@example.com` : email);

export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  constructor(private secret: string, private webhookSecret = secret, private currency = 'NGN', private base = 'https://api.paystack.co') {
    if (!secret.startsWith('sk_test_') && process.env.PAYSTACK_ALLOW_LIVE !== '1') throw new Error('PaystackProvider only accepts test keys (sk_test_...)');
    if (!['NGN', 'GHS', 'KES', 'ZAR', 'USD'].includes(currency)) throw new Error(`unsupported Paystack currency ${currency}`);
  }
  private async call(path: string, init?: RequestInit) {
    const r = await fetch(this.base + path, { ...init, headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' } });
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok || j.status === false) throw new Error(`paystack ${path} ${r.status}: ${j.message ?? ''}`);
    return j;
  }
  async initialize(a: { reference: string; amountKobo: bigint; email: string; callbackUrl?: string }) {
    const j = await this.call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({ reference: a.reference, amount: Number(a.amountKobo), currency: this.currency, email: payableEmail(a.email), callback_url: a.callbackUrl, metadata: { orderId: a.reference } }),
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
    return { paid: j.data.status === 'success', failed: ['failed', 'reversed'].includes(j.data.status), amountKobo: BigInt(j.data.amount), feeKobo: BigInt(j.data.fees ?? 0) };
  }
  /** Banks that can receive transfers, for the vendor payout form. */
  async listBanks(country = 'nigeria') {
    const j = await this.call(`/bank?country=${encodeURIComponent(country)}&currency=${this.currency}&perPage=100`);
    return (j.data as any[]).filter((b) => b.active && !b.is_deleted).map((b) => ({ name: b.name as string, code: b.code as string }));
  }
  /** Looks the account holder name up at the bank, so a vendor cannot register a typo'd account. */
  async resolveAccount(accountNumber: string, bankCode: string) {
    const j = await this.call(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
    return { accountName: j.data.account_name as string };
  }
  async createRecipient(a: { name: string; accountNumber: string; bankCode: string }) {
    const j = await this.call('/transferrecipient', { method: 'POST', body: JSON.stringify({ type: 'nuban', name: a.name, account_number: a.accountNumber, bank_code: a.bankCode, currency: this.currency }) });
    return { recipientCode: j.data.recipient_code as string };
  }
  /** Pay a vendor their net earnings. The reference doubles as the idempotency key: Paystack rejects a duplicate reference. */
  async transferToVendor(a: { accountId: string; amountKobo: bigint; idempotencyKey: string; description?: string }) {
    const reference = a.idempotencyKey.toLowerCase().replace(/[^a-z0-9_-]/g, '-').padEnd(16, '0'); // spec: lowercase alphanumeric, "-" "_" only, min 16
    const j = await this.call('/transfer', { method: 'POST', body: JSON.stringify({ source: 'balance', amount: Number(a.amountKobo), recipient: a.accountId, reference, reason: a.description ?? 'Oja Market payout' }) });
    // "otp" means the account still requires OTP approval for transfers: not paid, so fail and let the payout transaction roll back
    if (j.data.status === 'otp') throw new Error('paystack transfer needs OTP approval: disable "Confirm transfers before sending" in the Paystack dashboard');
    return { transferId: j.data.transfer_code as string };
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
  async transferToVendor(a: { idempotencyKey: string }) { return { transferId: `fake-${a.idempotencyKey}` }; }
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
