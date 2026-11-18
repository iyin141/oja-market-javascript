import { Body, Controller, Get, HttpStatus, Inject, Injectable, MessageEvent, Param, Post, Query, Sse } from '@nestjs/common';
import IORedis from 'ioredis';
import { Observable } from 'rxjs';
import { z } from 'zod';
import { SubOrderState, canTransition, deriveOrderStatus } from '@oja/shared';
import { Prisma_, Tx } from '../infra/prisma';
import { Jobs } from '../infra/jobs';
import { JOBS, REDIS } from '../tokens';
import { config } from '../config';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { Problem, Z } from '../common/http';
import { InventoryService } from './inventory';
import { A, LedgerService } from './ledger';

/** Redis pub/sub so the worker process can push to API-held SSE connections. */
@Injectable()
export class OrderEvents {
  constructor(@Inject(REDIS) private redis: IORedis) {}
  publish(userId: string, ev: Record<string, unknown>) { return this.redis.publish(`ev:${userId}`, JSON.stringify(ev)); }
  stream(userId: string): Observable<MessageEvent> {
    return new Observable((sub) => {
      const r = this.redis.duplicate();
      r.subscribe(`ev:${userId}`).catch((e) => sub.error(e));
      r.on('message', (_c, m) => sub.next({ data: JSON.parse(m) }));
      const ping = setInterval(() => sub.next({ data: { type: 'ping' } }), 25_000);
      return () => { clearInterval(ping); r.disconnect(); };
    });
  }
}

@Injectable()
export class OrdersService {
  constructor(private db: Prisma_, private inv: InventoryService, private ledger: LedgerService, private events: OrderEvents, @Inject(JOBS) private jobs: Jobs) {}

  /** Atomic guarded transition: succeeds only if the row is currently in one of `from` (and the machine allows each hop). */
  async transition(tx: Tx, subOrderId: string, from: SubOrderState[], to: SubOrderState, set: Record<string, unknown> = {}) {
    for (const f of from) if (!canTransition(f, to)) throw new Error(`state machine does not allow ${f} -> ${to}`);
    const r = await tx.subOrder.updateMany({ where: { id: subOrderId, status: { in: from } }, data: { status: to, ...set } });
    if (r.count !== 1) {
      const cur = await tx.subOrder.findUnique({ where: { id: subOrderId } });
      if (!cur) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'sub-order not found');
      throw new Problem(HttpStatus.CONFLICT, 'Illegal transition', `${cur.status} -> ${to}`);
    }
  }

  private shape(o: any) {
    return { ...o, status: deriveOrderStatus(o.subOrders.map((s: any) => s.status)) };
  }

  async list(userId: string) {
    const rows = await this.db.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, include: { subOrders: { include: { items: true, vendor: { select: { storeName: true } } } } } });
    return rows.map((o) => this.shape(o));
  }

  async get(u: AuthUser, id: string) {
    const o = await this.db.order.findFirst({
      where: { id, ...(u.role === 'ADMIN' ? {} : { userId: u.id }) },
      include: { subOrders: { include: { items: true, vendor: { select: { storeName: true } }, returns: true } }, payments: true },
    });
    if (!o) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'order not found');
    return this.shape(o);
  }

  private async vendorOf(userId: string) {
    const v = await this.db.vendorProfile.findUnique({ where: { userId } });
    if (!v) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', 'no vendor profile');
    return v;
  }

  async vendorList(userId: string, status?: string) {
    const v = await this.vendorOf(userId);
    return this.db.subOrder.findMany({
      where: { vendorId: v.id, ...(status ? { status: status as any } : {}) }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { items: true, order: { select: { address: true, paymentMethod: true, user: { select: { name: true } } } } },
    });
  }

  /** Delivery queue for agents/admins: everything shipped and not yet delivered (there is no per-agent assignment in the schema). */
  agentQueue() {
    return this.db.subOrder.findMany({
      where: { status: 'SHIPPED' }, orderBy: { shippedAt: 'asc' }, take: 100,
      include: { items: true, vendor: { select: { storeName: true } }, order: { select: { address: true, paymentMethod: true, user: { select: { name: true } } } } },
    });
  }

  async ship(userId: string, subOrderId: string, courier: string, trackingNo: string) {
    const v = await this.vendorOf(userId);
    const so = await this.db.subOrder.findFirst({ where: { id: subOrderId, vendorId: v.id }, include: { order: true } });
    if (!so) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'sub-order not found');
    await this.db.$transaction(async (tx) => {
      if (so.status !== 'PACKED') await this.transition(tx, subOrderId, ['PAID', 'AWAITING_COLLECTION'], 'PACKED');
      await this.transition(tx, subOrderId, ['PACKED'], 'SHIPPED', { shippedAt: new Date(), courier, trackingNo });
    });
    await this.events.publish(so.order.userId, { type: 'sub_order.shipped', orderId: so.orderId, subOrderId, status: 'SHIPPED' });
    await this.jobs.notify(so.order.userId, 'order.shipped', { orderId: so.orderId, courier, trackingNo });
    return { id: subOrderId, status: 'SHIPPED' };
  }

  /** Customer actions: confirm delivery, cancel. */
  async customerEvent(u: AuthUser, orderId: string, type: 'CONFIRM_DELIVERY' | 'CANCEL', subOrderId?: string) {
    const o = await this.db.order.findFirst({ where: { id: orderId, userId: u.id }, include: { subOrders: true } });
    if (!o) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'order not found');
    const targets = o.subOrders.filter((s) => !subOrderId || s.id === subOrderId);
    if (!targets.length) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'sub-order not found');
    if (type === 'CONFIRM_DELIVERY') {
      for (const s of targets) await this.db.$transaction((tx) => this.transition(tx, s.id, ['SHIPPED'], 'DELIVERED', { deliveredAt: new Date() }));
    } else {
      for (const s of targets) await this.cancelSubOrder(s.id, o.paymentMethod === 'COD');
    }
    await this.events.publish(u.id, { type: `order.${type.toLowerCase()}`, orderId });
    return this.get(u, orderId);
  }

  /** PENDING_PAYMENT: just release stock. PAID/PACKED: reverse the ledger from the pending bucket and restock. */
  async cancelSubOrder(subOrderId: string, cod: boolean) {
    await this.db.$transaction(async (tx) => {
      const [so] = await tx.$queryRaw<any[]>`SELECT * FROM sub_orders WHERE id = ${subOrderId}::uuid FOR UPDATE`;
      if (!so) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found');
      const from = ['PENDING_PAYMENT', 'PAID', 'AWAITING_COLLECTION', 'PACKED'] as SubOrderState[];
      await this.transition(tx, subOrderId, from, 'CANCELLED');
      const money = { id: so.id, vendorId: so.vendor_id, subtotalKobo: so.subtotal_kobo, commissionKobo: so.commission_kobo };
      if (so.status === 'PENDING_PAYMENT') {
        // release only this sub-order's share of reservations (reservations are per order+variant)
        const items = await tx.orderItem.findMany({ where: { subOrderId } });
        for (const it of items) {
          const n = await tx.$executeRaw`UPDATE reservations SET status = 'RELEASED' WHERE id = (SELECT id FROM reservations WHERE order_id = ${so.order_id}::uuid AND variant_id = ${it.variantId}::uuid AND status = 'ACTIVE' LIMIT 1)`;
          if (n) await tx.$executeRaw`UPDATE inventory SET reserved = reserved - ${it.qty} WHERE variant_id = ${it.variantId}::uuid`;
        }
        return;
      }
      for (const it of await tx.orderItem.findMany({ where: { subOrderId } })) {
        await tx.$executeRaw`UPDATE inventory SET on_hand = on_hand + ${it.qty} WHERE variant_id = ${it.variantId}::uuid`;
      }
      if (so.paid_at || !cod) {
        const g = await this.ledger.post(tx, `cancel:${subOrderId}`, subOrderId, [
          { account: A.pending, dir: 'DEBIT', amount: BigInt(money.subtotalKobo) - BigInt(money.commissionKobo), vendorId: money.vendorId },
          { account: A.commission, dir: 'DEBIT', amount: BigInt(money.commissionKobo) },
          { account: cod ? A.cod : A.gateway, dir: 'CREDIT', amount: BigInt(money.subtotalKobo) },
        ]);
        void g;
      }
    });
  }

  /** Agent/admin: delivered; for COD the cash handover posts the ledger exactly once. */
  async agentDeliver(subOrderId: string, cashCollected: boolean) {
    const so = await this.db.subOrder.findUnique({ where: { id: subOrderId }, include: { order: true } });
    if (!so) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'sub-order not found');
    const cod = so.order.paymentMethod === 'COD';
    if (cod && !cashCollected) throw new Problem(HttpStatus.CONFLICT, 'Cash required', 'COD orders need cash collected to complete delivery');
    await this.db.$transaction(async (tx) => {
      await this.transition(tx, subOrderId, ['SHIPPED'], 'DELIVERED', { deliveredAt: new Date(), ...(cod ? { paidAt: new Date() } : {}) });
      if (cod) await this.ledger.postCodCollected(tx, `cod:${subOrderId}`, { id: so.id, vendorId: so.vendorId, subtotalKobo: so.subtotalKobo, commissionKobo: so.commissionKobo });
    });
    await this.events.publish(so.order.userId, { type: 'sub_order.delivered', orderId: so.orderId, subOrderId, status: 'DELIVERED' });
    return { id: subOrderId, status: 'DELIVERED' };
  }

  /** Delivered + hold period => SETTLED; vendor share pending -> available (a posting, not an edit). */
  async settleDue(now = new Date()) {
    const cutoff = new Date(now.getTime() - config.settlementHoldDays * 86400_000);
    const due = await this.db.subOrder.findMany({ where: { status: 'DELIVERED', deliveredAt: { lte: cutoff }, paidAt: { not: null } }, select: { id: true } });
    let n = 0;
    for (const { id } of due) {
      await this.db.$transaction(async (tx) => {
        const r = await tx.subOrder.updateMany({ where: { id, status: 'DELIVERED' }, data: { status: 'SETTLED', settledAt: now } });
        if (r.count !== 1) return;
        const so = await tx.subOrder.findUniqueOrThrow({ where: { id } });
        await this.ledger.settle(tx, so);
        n++;
      });
    }
    return n;
  }
}

@Controller()
export class OrdersController {
  constructor(private o: OrdersService, private ev: OrderEvents) {}
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Get('orders') list(@CurrentUser() u: AuthUser) { return this.o.list(u.id); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Sse('orders/stream') stream(@CurrentUser() u: AuthUser) { return this.ev.stream(u.id); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Get('orders/:id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.o.get(u, id); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Post('orders/:id/events')
  event(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ type: z.enum(['CONFIRM_DELIVERY', 'CANCEL']), subOrderId: z.string().uuid().optional() }))) b: any) {
    return this.o.customerEvent(u, id, b.type, b.subOrderId);
  }

  @Roles('VENDOR') @Get('vendor/orders') vendorList(@CurrentUser() u: AuthUser, @Query('status') s?: string) { return this.o.vendorList(u.id, s); }
  @Roles('VENDOR') @Post('vendor/orders/:id/ship')
  ship(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ courier: z.string().min(2).max(60), trackingNo: z.string().min(3).max(60) }))) b: any) { return this.o.ship(u.id, id, b.courier, b.trackingNo); }

  @Roles('AGENT', 'ADMIN') @Get('agent/sub-orders') agentQueue() { return this.o.agentQueue(); }
  @Roles('AGENT', 'ADMIN') @Post('agent/sub-orders/:id/deliver')
  deliver(@Param('id') id: string, @Body(Z(z.object({ cashCollected: z.boolean().default(false) }))) b: any) { return this.o.agentDeliver(id, b.cashCollected); }
}
