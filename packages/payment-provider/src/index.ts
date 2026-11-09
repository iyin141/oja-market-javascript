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
