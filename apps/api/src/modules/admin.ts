import { Body, Controller, Get, HttpStatus, Inject, Injectable, Post, Put, Query } from '@nestjs/common';
import type { PaymentProvider } from '@oja/payment-provider';
import { PAYMENT } from '../tokens';
import { z } from 'zod';
import { Prisma_ } from '../infra/prisma';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { Problem, Z } from '../common/http';
import { LedgerService } from './ledger';

@Injectable()
export class PayoutsService {
  constructor(private db: Prisma_, private ledger: LedgerService, @Inject(PAYMENT) private pay: PaymentProvider) {}

  /** Idempotent per (vendor, runKey): the unique row is the guard, so re-running the same key pays nobody twice. */
  async run(runKey = new Date().toISOString().slice(0, 10)) {
    const vendors = await this.db.$queryRaw<{ vendor_id: string }[]>`SELECT vendor_id FROM vendor_balances WHERE available_kobo > 0`;
    let paid = 0, total = 0n;
    for (const { vendor_id } of vendors) {
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM vendor_profiles WHERE id = ${vendor_id}::uuid FOR UPDATE`;
        const [b] = await tx.$queryRaw<{ available_kobo: bigint }[]>`SELECT available_kobo FROM vendor_balances WHERE vendor_id = ${vendor_id}::uuid`;
        if (!b || b.available_kobo <= 0n) return;
        const ins = await tx.$queryRaw<{ id: string }[]>`INSERT INTO payouts (id, vendor_id, run_key, amount_kobo) VALUES (gen_random_uuid(), ${vendor_id}::uuid, ${runKey}, ${b.available_kobo}) ON CONFLICT (vendor_id, run_key) DO NOTHING RETURNING id`;
        if (!ins.length) return;
        // Real money first, inside the transaction: if the transfer throws, the payout row and ledger entry roll back, and the
        // Idempotency-Key makes a retry safe. Vendors without a connected account are settled in the ledger only (manual bank payout).
        const [vp] = await tx.$queryRaw<{ stripe_account_id: string | null }[]>`SELECT stripe_account_id FROM vendor_profiles WHERE id = ${vendor_id}::uuid`;
        if (this.pay.transferToVendor && vp?.stripe_account_id) await this.pay.transferToVendor({ accountId: vp.stripe_account_id, amountKobo: b.available_kobo, idempotencyKey: `payout:${ins[0].id}`, description: `Oja payout ${runKey}` });
        await this.ledger.payout(tx, `payout:${ins[0].id}`, vendor_id, b.available_kobo);
        paid++; total += b.available_kobo;
      }, { timeout: 30_000 });
    }
    return { runKey, vendorsPaid: paid, totalKobo: total };
  }
}

@Injectable()
export class AdminService {
  constructor(private db: Prisma_, private ledger: LedgerService) {}

  async kpis() {
    const [gmv] = await this.db.$queryRaw<any[]>`SELECT coalesce(sum(subtotal_kobo) FILTER (WHERE status NOT IN ('PENDING_PAYMENT','EXPIRED','CANCELLED')), 0)::bigint AS gmv, count(*) FILTER (WHERE status NOT IN ('PENDING_PAYMENT','EXPIRED','CANCELLED'))::int AS orders, coalesce(sum(subtotal_kobo) FILTER (WHERE status = 'REFUNDED'), 0)::bigint AS refunded FROM sub_orders`;
    const [com] = await this.db.$queryRaw<any[]>`SELECT coalesce(sum(CASE direction WHEN 'CREDIT' THEN amount_kobo ELSE -amount_kobo END), 0)::bigint AS commission FROM ledger_entries WHERE account = 'platform_commission'`;
    const [counts] = await this.db.$queryRaw<any[]>`SELECT (SELECT count(*) FROM vendor_profiles WHERE status = 'KYC_SUBMITTED')::int AS pending_vendors, (SELECT count(*) FROM products WHERE status = 'REVIEW')::int AS pending_products, (SELECT count(*) FROM return_requests WHERE status = 'DISPUTED')::int AS open_disputes, (SELECT count(*) FROM vendor_profiles WHERE flagged)::int AS flagged_vendors`;
    return { gmvKobo: gmv.gmv, paidSubOrders: gmv.orders, refundedKobo: gmv.refunded, commissionKobo: com.commission, pendingVendors: counts.pending_vendors, pendingProducts: counts.pending_products, openDisputes: counts.open_disputes, flaggedVendors: counts.flagged_vendors, ledger: await this.ledger.check() };
  }

  /** Time series + leaderboards for the admin analytics page. Money is bigint kobo (serialised as strings). */
  async analytics(days: number) {
    const daily = await this.db.$queryRaw<any[]>`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day, coalesce(sum(s.subtotal_kobo), 0)::bigint AS gmv_kobo, count(s.id)::int AS orders
      FROM generate_series(current_date - (${days}::int - 1), current_date, '1 day') AS d(day)
      LEFT JOIN sub_orders s ON s.created_at::date = d.day::date AND s.status NOT IN ('PENDING_PAYMENT','EXPIRED','CANCELLED')
      GROUP BY d.day ORDER BY d.day`;
    const topVendors = await this.db.$queryRaw<any[]>`
      SELECT vp.store_name AS name, sum(s.subtotal_kobo)::bigint AS gmv_kobo, sum(s.commission_kobo)::bigint AS commission_kobo, count(*)::int AS orders
      FROM sub_orders s JOIN vendor_profiles vp ON vp.id = s.vendor_id
      WHERE s.status NOT IN ('PENDING_PAYMENT','EXPIRED','CANCELLED') GROUP BY vp.store_name ORDER BY gmv_kobo DESC LIMIT 5`;
    const topProducts = await this.db.$queryRaw<any[]>`
      SELECT oi.title, sum(oi.qty)::int AS units, sum(oi.qty * oi.unit_price_kobo)::bigint AS revenue_kobo
      FROM order_items oi JOIN sub_orders s ON s.id = oi.sub_order_id
      WHERE s.status NOT IN ('PENDING_PAYMENT','EXPIRED','CANCELLED') GROUP BY oi.title ORDER BY revenue_kobo DESC LIMIT 5`;
    const [coupons] = await this.db.$queryRaw<any[]>`SELECT coalesce(sum(discount_kobo), 0)::bigint AS discount_kobo, count(*) FILTER (WHERE coupon_code IS NOT NULL)::int AS orders_with_coupon FROM orders`;
    return { days, daily, topVendors, topProducts, coupons };
  }

  rules() { return this.db.commissionRule.findMany({ include: { category: { select: { name: true } } } }); }

  /** Affects NEW orders only: sub_orders carry their own commission snapshot. */
  async setRule(adminId: string, categoryId: string | null, bps: number) {
    const existing = await this.db.commissionRule.findFirst({ where: { categoryId } });
    const rule = existing
      ? await this.db.commissionRule.update({ where: { id: existing.id }, data: { bps, updatedAt: new Date() } })
      : await this.db.commissionRule.create({ data: { categoryId, bps } });
    await this.db.auditLog.create({ data: { actorId: adminId, action: 'commission.set', entity: 'commission_rule', entityId: rule.id, meta: { categoryId, bps, previous: existing?.bps ?? null } } });
    return rule;
  }

  audit(limit = 100) { return this.db.auditLog.findMany({ orderBy: { id: 'desc' }, take: limit }); }
}

@Controller()
export class AdminController {
  constructor(private a: AdminService, private payouts: PayoutsService, private db: Prisma_) {}
  @Roles('ADMIN') @Get('admin/kpis') kpis() { return this.a.kpis(); }
  @Roles('ADMIN') @Get('admin/analytics') analytics(@Query('days') d?: string) { return this.a.analytics(Math.min(Math.max(Number(d) || 14, 1), 90)); }
  @Roles('ADMIN') @Get('admin/commission-rules') rules() { return this.a.rules(); }
  @Roles('ADMIN') @Put('admin/commission-rules')
  setRule(@CurrentUser() u: AuthUser, @Body(Z(z.object({ categoryId: z.string().uuid().nullable(), bps: z.number().int().min(0).max(10000) }))) b: any) { return this.a.setRule(u.id, b.categoryId, b.bps); }
  @Roles('ADMIN') @Get('admin/audit') audit(@Query('limit') l?: string) { return this.a.audit(Math.min(Number(l) || 100, 500)); }
  @Roles('ADMIN') @Post('admin/payouts/run')
  async run(@CurrentUser() u: AuthUser, @Body(Z(z.object({ runKey: z.string().min(1).max(60).optional() }))) b: any) {
    const r = await this.payouts.run(b.runKey);
    await this.db.auditLog.create({ data: { actorId: u.id, action: 'payouts.run', entity: 'payout_run', entityId: r.runKey, meta: { vendorsPaid: r.vendorsPaid, totalKobo: r.totalKobo.toString() } } });
    return r;
  }
  @Roles('VENDOR') @Get('vendor/payouts')
  async myPayouts(@CurrentUser() u: AuthUser) {
    const v = await this.db.vendorProfile.findUnique({ where: { userId: u.id } });
    if (!v) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden');
    return this.db.payout.findMany({ where: { vendorId: v.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN', 'AGENT') @Get('me/notifications')
  notifications(@CurrentUser() u: AuthUser) { return this.db.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 }); }
}
