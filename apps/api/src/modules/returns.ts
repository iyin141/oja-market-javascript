import { Body, Controller, Get, HttpStatus, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Prisma_, Tx } from '../infra/prisma';
import { Jobs } from '../infra/jobs';
import { JOBS } from '../tokens';
import { config } from '../config';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { Problem, Z } from '../common/http';
import { LedgerService } from './ledger';
import { OrdersService } from './orders';

const RETURN_WINDOW_MS = 7 * 86400_000;
const VENDOR_SLA_MS = 48 * 3600_000;

export function computeScore(s: { delivered: number; refunded: number; slaMisses: number }) {
  const refundPct = s.delivered ? Math.round((100 * s.refunded) / s.delivered) : 0;
  return Math.max(0, Math.min(100, 100 - refundPct - 5 * s.slaMisses));
}
/** Hysteresis (flag <60, unflag >=70) and a minimum sample so new vendors are not flagged on one bad order. */
export function nextFlag(score: number, delivered: number, flagged: boolean) {
  if (delivered < 5) return flagged;
  return flagged ? score < 70 : score < 60;
}

@Injectable()
export class ReturnsService {
  constructor(private db: Prisma_, private ledger: LedgerService, private orders: OrdersService, @Inject(JOBS) private jobs: Jobs) {}

  async request(u: AuthUser, orderId: string, subOrderId: string, reason: string) {
    return this.db.$transaction(async (tx) => {
      const so = await tx.subOrder.findFirst({ where: { id: subOrderId, orderId, order: { userId: u.id } }, include: { vendor: true } });
      if (!so) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'sub-order not found');
      if (!so.deliveredAt || Date.now() - so.deliveredAt.getTime() > RETURN_WINDOW_MS) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Return window closed', 'returns are accepted within 7 days of delivery');
      await this.orders.transition(tx, subOrderId, ['DELIVERED'], 'RETURN_REQUESTED');
      await this.ledger.moveToHold(tx, so);
      const r = await tx.returnRequest.create({ data: { subOrderId, userId: u.id, reason, vendorDeadline: new Date(Date.now() + VENDOR_SLA_MS) } });
      await this.jobs.notify(so.vendor.userId, 'return.requested', { returnId: r.id, subOrderId });
      return r;
    });
  }

  private async refund(tx: Tx, ret: { id: string; subOrderId: string }, decidedBy: string | null) {
    const so = await tx.subOrder.findUniqueOrThrow({ where: { id: ret.subOrderId }, include: { order: true } });
    await this.orders.transition(tx, so.id, ['RETURN_REQUESTED'], 'REFUNDED');
    await this.ledger.refund(tx, so, so.subtotalKobo, so.order.paymentMethod === 'COD');
    await tx.returnRequest.update({ where: { id: ret.id }, data: { status: 'REFUNDED', decidedBy } });
    await this.jobs.notify(so.order.userId, 'return.refunded', { returnId: ret.id, amountKobo: so.subtotalKobo.toString() });
  }

  async vendorRespond(u: AuthUser, returnId: string, accept: boolean, note?: string) {
    return this.db.$transaction(async (tx) => {
      const r = await tx.returnRequest.findFirst({ where: { id: returnId, subOrder: { vendor: { userId: u.id } } } });
      if (!r) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'return not found');
      if (r.status !== 'REQUESTED') throw new Problem(HttpStatus.CONFLICT, 'Illegal transition', `return is ${r.status}`);
      await tx.returnRequest.update({ where: { id: r.id }, data: { vendorResponse: note ?? (accept ? 'accepted' : 'disputed') } });
      if (accept) await this.refund(tx, r, u.id);
      else await tx.returnRequest.update({ where: { id: r.id }, data: { status: 'DISPUTED' } });
      return tx.returnRequest.findUniqueOrThrow({ where: { id: r.id } });
    });
  }

  async adminDecide(admin: AuthUser, returnId: string, decision: 'REFUND' | 'REJECT') {
    return this.db.$transaction(async (tx) => {
      const r = await tx.returnRequest.findUnique({ where: { id: returnId } });
      if (!r) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'return not found');
      if (r.status !== 'DISPUTED') throw new Problem(HttpStatus.CONFLICT, 'Illegal transition', `return is ${r.status}, only DISPUTED can be decided`);
      if (decision === 'REFUND') await this.refund(tx, r, admin.id);
      else {
        // Vendor wins: unfreeze balance and put the order back to DELIVERED.
        const so = await tx.subOrder.findUniqueOrThrow({ where: { id: r.subOrderId } });
        await this.orders.transition(tx, so.id, ['RETURN_REQUESTED'], 'DELIVERED');
        await this.ledger.releaseHold(tx, so);
        await tx.returnRequest.update({ where: { id: r.id }, data: { status: 'REJECTED', decidedBy: admin.id } });
      }
      await tx.auditLog.create({ data: { actorId: admin.id, action: `dispute.${decision.toLowerCase()}`, entity: 'return', entityId: r.id } });
      return tx.returnRequest.findUniqueOrThrow({ where: { id: r.id } });
    });
  }

  /** 48h vendor SLA: silence = accepted. Idempotent: only touches REQUESTED rows past deadline. */
  async slaSweep(now = new Date()) {
    const late = await this.db.returnRequest.findMany({ where: { status: 'REQUESTED', vendorDeadline: { lt: now } }, select: { id: true, subOrderId: true } });
    let n = 0;
    for (const r of late) {
      await this.db.$transaction(async (tx) => {
        const cur = await tx.returnRequest.findUnique({ where: { id: r.id } });
        if (cur?.status !== 'REQUESTED') return;
        await tx.returnRequest.update({ where: { id: r.id }, data: { vendorResponse: 'SLA_MISSED' } });
        await this.refund(tx, r, null);
        await tx.auditLog.create({ data: { action: 'return.sla_auto_refund', entity: 'return', entityId: r.id } });
        n++;
      });
    }
    return n;
  }

  /** Nightly: score from last 90 days, auto-flag (flag removes COD eligibility). */
  async scoreVendors(now = new Date()) {
    const since = new Date(now.getTime() - 90 * 86400_000);
    const vendors = await this.db.vendorProfile.findMany({ where: { status: 'APPROVED' } });
    for (const v of vendors) {
      const [delivered, refunded, slaMisses] = await Promise.all([
        this.db.subOrder.count({ where: { vendorId: v.id, deliveredAt: { gte: since } } }),
        this.db.subOrder.count({ where: { vendorId: v.id, status: 'REFUNDED', deliveredAt: { gte: since } } }),
        this.db.returnRequest.count({ where: { vendorResponse: 'SLA_MISSED', createdAt: { gte: since }, subOrder: { vendorId: v.id } } }),
      ]);
      const score = computeScore({ delivered, refunded, slaMisses });
      const flagged = nextFlag(score, delivered, v.flagged);
      await this.db.vendorProfile.update({ where: { id: v.id }, data: { score, flagged } });
      if (flagged !== v.flagged) await this.db.auditLog.create({ data: { action: flagged ? 'vendor.auto_flag' : 'vendor.auto_unflag', entity: 'vendor', entityId: v.id, meta: { score } } });
    }
    return vendors.length;
  }

  vendorList(u: AuthUser) {
    return this.db.returnRequest.findMany({ where: { subOrder: { vendor: { userId: u.id } } }, include: { subOrder: { include: { items: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  disputes() { return this.db.returnRequest.findMany({ where: { status: 'DISPUTED' }, include: { subOrder: { include: { items: true, vendor: { select: { storeName: true } } } } }, orderBy: { createdAt: 'asc' } }); }
  mine(u: AuthUser) { return this.db.returnRequest.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } }); }
}

/** "Ada Obi" -> "Ada O."; never the email, never the full surname. */
export function displayName(name: string | null | undefined): string {
  const [first, ...rest] = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!first) return 'Customer';
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

@Injectable()
export class ReviewsService {
  constructor(private db: Prisma_) {}
  async create(u: AuthUser, productId: string, rating: number, body: string) {
    const bought = await this.db.orderItem.findFirst({ where: { productId, subOrder: { status: { in: ['DELIVERED', 'SETTLED'] }, order: { userId: u.id } } } });
    if (!bought) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', 'only verified buyers (delivered orders) can review');
    return this.db.$transaction(async (tx) => {
      try { await tx.review.create({ data: { productId, userId: u.id, rating, body } }); }
      catch (e: any) { if (e.code === 'P2002') throw new Problem(HttpStatus.CONFLICT, 'Conflict', 'already reviewed'); throw e; }
      const a = await tx.review.aggregate({ where: { productId }, _avg: { rating: true }, _count: true });
      await tx.product.update({ where: { id: productId }, data: { ratingAvg: a._avg.rating ?? 0, ratingCount: a._count } });
      return { ok: true };
    });
  }
  async list(productId: string, limit = 20) {
    if (!/^[0-9a-f-]{36}$/i.test(productId)) return [];
    const rows = await this.db.review.findMany({ where: { productId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 50), include: { user: { select: { name: true } } } });
    return rows.map((r) => ({ id: r.id, rating: r.rating, body: r.body, authorName: displayName(r.user.name), createdAt: r.createdAt }));
  }
}

@Controller()
export class ReturnsController {
  constructor(private r: ReturnsService, private rev: ReviewsService) {}
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Post('orders/:id/returns')
  request(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ subOrderId: z.string().uuid(), reason: z.string().min(5).max(1000) }))) b: any) { return this.r.request(u, id, b.subOrderId, b.reason); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Get('me/returns') mine(@CurrentUser() u: AuthUser) { return this.r.mine(u); }
  @Roles('VENDOR') @Get('vendor/returns') vendorList(@CurrentUser() u: AuthUser) { return this.r.vendorList(u); }
  @Roles('VENDOR') @Post('vendor/returns/:id/respond')
  respond(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ accept: z.boolean(), note: z.string().max(1000).optional() }))) b: any) { return this.r.vendorRespond(u, id, b.accept, b.note); }
  @Roles('ADMIN') @Get('admin/disputes') disputes() { return this.r.disputes(); }
  @Roles('ADMIN') @Post('admin/disputes/:id/decide')
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ decision: z.enum(['REFUND', 'REJECT']) }))) b: any) { return this.r.adminDecide(u, id, b.decision); }

  @Public() @Get('products/:id/reviews')
  reviews(@Param('id') id: string, @Query(Z(z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }))) q: any) { return this.rev.list(id, q.limit); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Post('products/:id/reviews')
  review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ rating: z.number().int().min(1).max(5), body: z.string().max(2000).default('') }))) b: any) { return this.rev.create(u, id, b.rating, b.body); }
}
