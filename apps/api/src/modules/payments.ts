import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Injectable, NotFoundException, Param, Post, RawBodyRequest, Req } from '@nestjs/common';
import { FakeProvider, PaymentProvider } from '@oja/payment-provider';
import { Money } from '@oja/shared';
import { z } from 'zod';
import { Prisma_, Tx } from '../infra/prisma';
import { Jobs } from '../infra/jobs';
import { JOBS, PAYMENT } from '../tokens';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { Problem, Z, counters } from '../common/http';
import { InventoryService } from './inventory';
import { LedgerService } from './ledger';
import { OrderEvents } from './orders';

export type WebhookResult = { status: 'posted' | 'duplicate' | 'ignored' | 'late' | 'mismatch' | 'already_paid' };

@Injectable()
export class PaymentsService {
  constructor(private db: Prisma_, @Inject(PAYMENT) public provider: PaymentProvider, private inv: InventoryService, private ledger: LedgerService,
    private events: OrderEvents, @Inject(JOBS) private jobs: Jobs) {}

  /** Signature on the RAW body first; then everything happens in one TX keyed by payment_events.event_id UNIQUE. */
  async handleWebhook(raw: Buffer, signature: string | undefined): Promise<WebhookResult> {
    const ev = this.provider.parseWebhook(raw, signature);
    if (!ev) throw new Problem(HttpStatus.UNAUTHORIZED, 'Invalid signature');
    return this.process(ev, JSON.parse(raw.toString('utf8')));
  }

  async process(ev: { eventId: string; type: string; reference: string; amountKobo: bigint; feeKobo: bigint }, payload: unknown): Promise<WebhookResult> {
    const notify: { userId: string; type: string; data: Record<string, unknown> }[] = [];
    const result = await this.db.$transaction(async (tx): Promise<WebhookResult> => {
      const ins = await tx.$queryRaw<{ id: string }[]>`INSERT INTO payment_events (id, event_id, type, reference, payload) VALUES (gen_random_uuid(), ${ev.eventId}, ${ev.type}, ${ev.reference}, ${JSON.stringify(payload)}::jsonb) ON CONFLICT (event_id) DO NOTHING RETURNING id`;
      if (!ins.length) { counters.webhookDup.inc(); return { status: 'duplicate' }; }
      if (ev.type !== 'charge.success') return { status: 'ignored' };
      return this.postPaid(tx, ev, notify);
    }, { maxWait: 30_000, timeout: 30_000 });
    for (const n of notify) {
      await this.jobs.notify(n.userId, n.type, n.data);
      await this.events.publish(n.userId, { type: n.type, ...n.data });
    }
    return result;
  }

  private async postPaid(tx: Tx, ev: { eventId: string; reference: string; amountKobo: bigint; feeKobo: bigint }, notify: any[]): Promise<WebhookResult> {
    const [pay] = await tx.$queryRaw<any[]>`SELECT * FROM payments WHERE reference = ${ev.reference} FOR UPDATE`;
    if (!pay) return { status: 'ignored' };
    if (pay.status === 'PAID') return { status: 'already_paid' };
    if (pay.amount_kobo !== ev.amountKobo) {
      await tx.auditLog.create({ data: { action: 'payment.amount_mismatch', entity: 'payment', entityId: pay.id, meta: { expected: pay.amount_kobo.toString(), got: ev.amountKobo.toString() } } });
      return { status: 'mismatch' };
    }
    const order = await tx.order.findUniqueOrThrow({ where: { id: pay.order_id }, include: { subOrders: { orderBy: { id: 'asc' }, include: { vendor: true } } } });
    await tx.payment.update({ where: { id: pay.id }, data: { status: 'PAID', feeKobo: ev.feeKobo } });
    const pending = order.subOrders.filter((s) => s.status === 'PENDING_PAYMENT');
    if (!pending.length) {
      // Reservation already expired: money is real, so book it as a refund liability instead of dropping it.
      await this.ledger.postLatePayment(tx, `payment:${ev.reference}`, ev.amountKobo);
      await tx.auditLog.create({ data: { action: 'payment.late_refund_required', entity: 'order', entityId: order.id } });
      return { status: 'late' };
    }
    // Processing fee split across sub-orders by subtotal; last one takes the rounding remainder.
    let feeLeft = ev.feeKobo;
    for (let i = 0; i < pending.length; i++) {
      const s = pending[i];
      const fee = i === pending.length - 1 ? feeLeft : Money.prorate(ev.feeKobo, s.subtotalKobo, order.totalKobo);
      feeLeft -= fee;
      await tx.subOrder.update({ where: { id: s.id }, data: { status: 'PAID', paidAt: new Date(), feeKobo: fee } });
      await this.ledger.postCardPayment(tx, `payment:${ev.reference}`, s, fee);
      notify.push({ userId: s.vendor.userId, type: 'order.new', data: { orderId: order.id, subOrderId: s.id } });
    }
    await this.inv.commit(tx, order.id);
    notify.push({ userId: order.userId, type: 'order.paid', data: { orderId: order.id } });
    counters.payments.inc();
    return { status: 'posted' };
  }

  /** Manual re-check with the gateway (webhook lost / delayed). Same code path and idempotency key as the webhook. */
  async verify(user: AuthUser, paymentId: string) {
    const p = await this.db.payment.findFirst({ where: { id: paymentId, order: { userId: user.id } } });
    if (!p) throw new NotFoundException();
    if (p.status === 'PAID') return { status: 'PAID' };
    const v = await this.provider.verify(p.reference);
    if (!v.paid) return { status: p.status };
    await this.process({ eventId: `verify:${p.reference}`, type: 'charge.success', reference: p.reference, amountKobo: p.amountKobo, feeKobo: v.feeKobo }, { source: 'verify' });
    return { status: 'PAID' };
  }

  /** Dev/test only: stands in for the hosted payment page by delivering a signed webhook to ourselves. */
  async fakeCharge(user: AuthUser, reference: string) {
    if (!(this.provider instanceof FakeProvider)) throw new NotFoundException();
    const p = await this.db.payment.findFirst({ where: { reference, order: { userId: user.id } } });
    if (!p) throw new NotFoundException();
    const { body, signature } = this.provider.buildChargeSuccess({ eventId: `fake-${reference}`, reference, amountKobo: p.amountKobo });
    return this.handleWebhook(body, signature);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private p: PaymentsService) {}

  @Public() @HttpCode(200) @Post('webhook')
  webhook(@Req() req: RawBodyRequest<any>, @Headers('x-paystack-signature') sig?: string) {
    return this.p.handleWebhook(req.rawBody ?? Buffer.alloc(0), sig);
  }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @HttpCode(200) @Post(':id/verify')
  verify(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.p.verify(u, id); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @HttpCode(200) @Post('fake/charge')
  fake(@CurrentUser() u: AuthUser, @Body(Z(z.object({ reference: z.string().uuid() }))) b: any) { return this.p.fakeCharge(u, b.reference); }
}
