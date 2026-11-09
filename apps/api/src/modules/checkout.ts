import { Body, Controller, Headers, HttpStatus, Inject, Injectable, Post } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Money, checkoutSchema } from '@oja/shared';
import type { PaymentProvider } from '@oja/payment-provider';
import { Prisma_ } from '../infra/prisma';
import { Jobs } from '../infra/jobs';
import { JOBS, PAYMENT } from '../tokens';
import { config } from '../config';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { Problem, Z, counters } from '../common/http';
import { InventoryService } from './inventory';
import { EFFECTIVE_PRICE_SQL } from './catalog';

interface CartLine { variant_id: string; qty: number; price: bigint; product_id: string; title: string; vendor_id: string; vendor_status: string; vendor_flagged: boolean; category_id: string; product_status: string }

@Injectable()
export class CheckoutService {
  constructor(private db: Prisma_, private inv: InventoryService, @Inject(PAYMENT) private pay: PaymentProvider, @Inject(JOBS) private jobs: Jobs) {}

  /**
   * One DB transaction: idempotency row, price recompute from DB, stock reserve, order + per-vendor sub-orders
   * with commission snapshot. Payment init happens after commit (spec 3). Same key => same response.
   */
  async checkout(user: AuthUser, rawKey: string | undefined, dto: z.infer<typeof checkoutSchema>) {
    if (!rawKey || rawKey.length > 100) throw new Problem(HttpStatus.BAD_REQUEST, 'Idempotency-Key required', 'send an Idempotency-Key header (max 100 chars)');
    const key = `${user.id}:${rawKey}`;
    let created: { orderId: string; total: bigint; cod: boolean; expiresAt: Date; subs: any[] };
    try {
      created = await this.db.$transaction((tx) => this.createOrder(tx, user, key, dto), { maxWait: 60_000, timeout: 60_000 });
    } catch (e: any) {
      if (e.code === 'P2002') return this.replay(user, key);
      throw e;
    }
    counters.orders.inc();
    let authorizationUrl: string | undefined;
    if (!created.cod) {
      await this.jobs.releaseReservation(created.orderId, config.reservationTtlMin * 60_000);
      authorizationUrl = (await this.pay.initialize({ reference: created.orderId, amountKobo: created.total, email: user.email, callbackUrl: `${config.webOrigin}/orders` })).authorizationUrl;
    }
    const response = JSON.parse(JSON.stringify({
      orderId: created.orderId, status: created.cod ? 'AWAITING_COLLECTION' : 'PENDING_PAYMENT', totalKobo: created.total,
      expiresAt: created.expiresAt, authorizationUrl, subOrders: created.subs,
    }));
    await this.db.checkoutRequest.update({ where: { idempotencyKey: key }, data: { response } });
    return response;
  }

  private async replay(user: AuthUser, key: string) {
    const r = await this.db.checkoutRequest.findUnique({ where: { idempotencyKey: key } });
    if (!r) throw new Problem(HttpStatus.CONFLICT, 'Conflict', 'checkout in progress');
    if (r.response) return r.response;
    // First request committed but has not stored its response yet: rebuild it.
    const o = await this.db.order.findUniqueOrThrow({ where: { id: r.orderId! }, include: { subOrders: true } });
    const init = o.paymentMethod === 'CARD' ? await this.pay.initialize({ reference: o.id, amountKobo: o.totalKobo, email: user.email }) : undefined;
    return JSON.parse(JSON.stringify({
      orderId: o.id, status: o.paymentMethod === 'CARD' ? 'PENDING_PAYMENT' : 'AWAITING_COLLECTION', totalKobo: o.totalKobo, expiresAt: o.expiresAt,
      authorizationUrl: init?.authorizationUrl, subOrders: o.subOrders.map((s) => ({ id: s.id, vendorId: s.vendorId, subtotalKobo: s.subtotalKobo, commissionBps: s.commissionBps, commissionKobo: s.commissionKobo })),
    }));
  }

  private async createOrder(tx: any, user: AuthUser, key: string, dto: z.infer<typeof checkoutSchema>) {
    await tx.checkoutRequest.create({ data: { idempotencyKey: key, userId: user.id } });

    const lines: CartLine[] = await tx.$queryRawUnsafe(
      `SELECT ci.variant_id, ci.qty, ${EFFECTIVE_PRICE_SQL} AS price, p.id AS product_id, p.title, p.vendor_id, vp.status::text AS vendor_status, vp.flagged AS vendor_flagged, p.category_id, p.status::text AS product_status
       FROM cart_items ci JOIN carts c ON c.id = ci.cart_id JOIN variants v ON v.id = ci.variant_id JOIN products p ON p.id = v.product_id JOIN vendor_profiles vp ON vp.id = p.vendor_id
       WHERE c.user_id = $1::uuid`, user.id);
    if (!lines.length) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Empty cart');
    const bad = lines.find((l) => l.product_status !== 'ACTIVE' || l.vendor_status !== 'APPROVED');
    if (bad) throw new Problem(HttpStatus.CONFLICT, 'Item unavailable', `"${bad.title}" is no longer available`);

    const cod = dto.paymentMethod === 'COD';
    const total = lines.reduce((s, l) => s + l.price * BigInt(l.qty), 0n); // prices come from the DB, never the client
    if (cod) {
      if (total > config.codLimitKobo) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'COD limit exceeded', `cash on delivery is limited to ${Money.format(config.codLimitKobo)}`);
      if (lines.some((l) => l.vendor_flagged)) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'COD unavailable', 'a vendor in this cart does not accept cash on delivery');
    }

    const rules: { categoryId: string | null; bps: number }[] = await tx.commissionRule.findMany();
    const byCat = new Map(rules.map((r) => [r.categoryId, r.bps]));
    const defaultBps = byCat.get(null) ?? 1000;

    const orderId = randomUUID();
    const expiresAt = new Date(Date.now() + config.reservationTtlMin * 60_000);
    await this.inv.reserve(tx, orderId, lines.map((l) => ({ variantId: l.variant_id, qty: l.qty })), expiresAt);

    await tx.order.create({ data: { id: orderId, userId: user.id, totalKobo: total, paymentMethod: dto.paymentMethod, address: dto.address ?? undefined, expiresAt } });
    const byVendor = new Map<string, CartLine[]>();
    for (const l of lines) byVendor.set(l.vendor_id, [...(byVendor.get(l.vendor_id) ?? []), l]);
    const subs: any[] = [];
    for (const [vendorId, vl] of byVendor) {
      const subtotal = vl.reduce((s, l) => s + l.price * BigInt(l.qty), 0n);
      // Commission snapshot: per-item category rate, summed. Effective bps stored alongside for display/audit.
      const commission = vl.reduce((s, l) => s + Money.bps(l.price * BigInt(l.qty), byCat.get(l.category_id) ?? defaultBps), 0n);
      const effBps = subtotal === 0n ? 0 : Number((commission * 10000n + subtotal / 2n) / subtotal);
      const so = await tx.subOrder.create({
        data: {
          orderId, vendorId, subtotalKobo: subtotal, commissionBps: effBps, commissionKobo: commission, status: cod ? 'AWAITING_COLLECTION' : 'PENDING_PAYMENT',
          items: { create: vl.map((l) => ({ variantId: l.variant_id, productId: l.product_id, title: l.title, qty: l.qty, unitPriceKobo: l.price })) },
        },
      });
      subs.push({ id: so.id, vendorId, subtotalKobo: subtotal, commissionBps: effBps, commissionKobo: commission });
    }
    if (cod) await this.inv.commit(tx, orderId);
    else await tx.payment.create({ data: { orderId, provider: this.pay.name, reference: orderId, amountKobo: total } });
    await tx.cartItem.deleteMany({ where: { cart: { userId: user.id } } });
    await tx.checkoutRequest.update({ where: { idempotencyKey: key }, data: { orderId } });
    return { orderId, total, cod, expiresAt, subs };
  }
}

@Controller('checkout')
export class CheckoutController {
  constructor(private c: CheckoutService) {}
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Post()
  checkout(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key: string | undefined, @Body(Z(checkoutSchema)) b: any) { return this.c.checkout(u, key, b); }
}
