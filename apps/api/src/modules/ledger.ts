import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Money } from '@oja/shared';
import { Prisma_, Tx } from '../infra/prisma';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { Problem } from '../common/http';

type Line = { account: string; dir: 'DEBIT' | 'CREDIT'; amount: bigint; vendorId?: string };
export interface SubOrderMoney { id: string; vendorId: string; subtotalKobo: bigint; commissionKobo: bigint }

export const A = {
  gateway: 'gateway_clearing', commission: 'platform_commission', fees: 'processing_fees',
  pending: 'vendor_payable_pending', available: 'vendor_payable_available', hold: 'vendor_payable_hold',
  payout: 'payout_clearing', cod: 'cod_clearing', refundDue: 'customer_refund_due',
} as const;

/**
 * Append-only double-entry postings. Each call is one balanced group; a deferred DB trigger
 * rejects any group whose debits != credits at COMMIT. Nothing here ever updates or deletes.
 */
@Injectable()
export class LedgerService {
  constructor(private db: Prisma_) {}

  async post(tx: Tx, ref: string, subOrderId: string | null, lines: Line[]) {
    const groupId = randomUUID();
    const rows = lines.filter((l) => l.amount > 0n).map((l) => ({
      groupId, subOrderId, vendorId: l.vendorId ?? null, account: l.account, direction: l.dir, amountKobo: l.amount, ref,
    }));
    if (rows.length) await tx.ledgerEntry.createMany({ data: rows });
    return groupId;
  }

  /** Card payment received for a sub-order: gross in, vendor share pending, commission + fee booked. */
  postCardPayment(tx: Tx, ref: string, s: SubOrderMoney, fee: bigint) {
    return this.post(tx, ref, s.id, [
      { account: A.gateway, dir: 'DEBIT', amount: s.subtotalKobo },
      { account: A.pending, dir: 'CREDIT', amount: s.subtotalKobo - s.commissionKobo, vendorId: s.vendorId },
      { account: A.commission, dir: 'CREDIT', amount: s.commissionKobo },
      { account: A.fees, dir: 'DEBIT', amount: fee },
      { account: A.gateway, dir: 'CREDIT', amount: fee },
    ]);
  }

  /** Cash collected by delivery agent (COD): same shape, no processing fee. */
  postCodCollected(tx: Tx, ref: string, s: SubOrderMoney) {
    return this.post(tx, ref, s.id, [
      { account: A.cod, dir: 'DEBIT', amount: s.subtotalKobo },
      { account: A.pending, dir: 'CREDIT', amount: s.subtotalKobo - s.commissionKobo, vendorId: s.vendorId },
      { account: A.commission, dir: 'CREDIT', amount: s.commissionKobo },
    ]);
  }

  /** Money arrived after the reservation expired: keep it visible as a liability to the customer. */
  postLatePayment(tx: Tx, ref: string, amount: bigint) {
    return this.post(tx, ref, null, [{ account: A.gateway, dir: 'DEBIT', amount }, { account: A.refundDue, dir: 'CREDIT', amount }]);
  }

  /** Hold elapsed: vendor share moves pending -> available as a new posting, never an edit. */
  settle(tx: Tx, s: SubOrderMoney) {
    const net = s.subtotalKobo - s.commissionKobo;
    return this.post(tx, `settle:${s.id}`, s.id, [
      { account: A.pending, dir: 'DEBIT', amount: net, vendorId: s.vendorId },
      { account: A.available, dir: 'CREDIT', amount: net, vendorId: s.vendorId },
    ]);
  }

  /** Return opened: freeze the vendor share. from = bucket it currently sits in. */
  moveToHold(tx: Tx, s: SubOrderMoney, from: string = A.pending) {
    const net = s.subtotalKobo - s.commissionKobo;
    return this.post(tx, `hold:${s.id}`, s.id, [
      { account: from, dir: 'DEBIT', amount: net, vendorId: s.vendorId },
      { account: A.hold, dir: 'CREDIT', amount: net, vendorId: s.vendorId },
    ]);
  }
  releaseHold(tx: Tx, s: SubOrderMoney) {
    const net = s.subtotalKobo - s.commissionKobo;
    return this.post(tx, `unhold:${s.id}`, s.id, [
      { account: A.hold, dir: 'DEBIT', amount: net, vendorId: s.vendorId },
      { account: A.pending, dir: 'CREDIT', amount: net, vendorId: s.vendorId },
    ]);
  }

  /** Refund of `amount` (<= gross) out of the held balance; commission share reversed proportionally. */
  refund(tx: Tx, s: SubOrderMoney, amount: bigint, cod: boolean) {
    const comm = Money.prorate(s.commissionKobo, amount, s.subtotalKobo);
    const vendorShare = amount - comm;
    const heldNet = s.subtotalKobo - s.commissionKobo;
    const lines: Line[] = [
      { account: A.hold, dir: 'DEBIT', amount: vendorShare, vendorId: s.vendorId },
      { account: A.commission, dir: 'DEBIT', amount: comm },
      { account: cod ? A.cod : A.gateway, dir: 'CREDIT', amount },
    ];
    // Unrefunded remainder of the vendor's frozen balance goes back to pending.
    const rest = heldNet - vendorShare;
    if (rest > 0n) lines.push({ account: A.hold, dir: 'DEBIT', amount: rest, vendorId: s.vendorId }, { account: A.pending, dir: 'CREDIT', amount: rest, vendorId: s.vendorId });
    return this.post(tx, `refund:${s.id}`, s.id, lines);
  }

  payout(tx: Tx, ref: string, vendorId: string, amount: bigint) {
    return this.post(tx, ref, null, [
      { account: A.available, dir: 'DEBIT', amount, vendorId },
      { account: A.payout, dir: 'CREDIT', amount, vendorId },
    ]);
  }

  async balance(vendorId: string) {
    const r = await this.db.$queryRaw<any[]>`SELECT pending_kobo, available_kobo, hold_kobo, paid_out_kobo FROM vendor_balances WHERE vendor_id = ${vendorId}::uuid`;
    const b = r[0] ?? { pending_kobo: 0n, available_kobo: 0n, hold_kobo: 0n, paid_out_kobo: 0n };
    return { pendingKobo: b.pending_kobo, availableKobo: b.available_kobo, holdKobo: b.hold_kobo, paidOutKobo: b.paid_out_kobo };
  }

  async check() {
    const [r] = await this.db.$queryRaw<any[]>`SELECT total_debits, total_credits, unbalanced_groups FROM ledger_check`;
    const [s] = await this.db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM (SELECT sub_order_id FROM ledger_entries WHERE sub_order_id IS NOT NULL GROUP BY sub_order_id HAVING sum(amount_kobo) FILTER (WHERE direction='DEBIT') IS DISTINCT FROM sum(amount_kobo) FILTER (WHERE direction='CREDIT')) x`;
    return { totalDebits: r.total_debits, totalCredits: r.total_credits, unbalancedGroups: r.unbalanced_groups, unbalancedSubOrders: s.n, ok: r.total_debits === r.total_credits && r.unbalanced_groups === 0n && s.n === 0n };
  }
}

async function vendorId(db: Prisma_, userId: string) {
  const v = await db.vendorProfile.findUnique({ where: { userId } });
  if (!v) throw new Problem(403, 'Forbidden', 'no vendor profile');
  return v.id;
}

@Controller()
export class LedgerController {
  constructor(private ledger: LedgerService, private db: Prisma_) {}
  @Roles('VENDOR') @Get('vendor/balance')
  async balance(@CurrentUser() u: AuthUser) { return this.ledger.balance(await vendorId(this.db, u.id)); }

  @Roles('VENDOR') @Get('vendor/transactions')
  async tx(@CurrentUser() u: AuthUser, @Query('limit') limit = '50') {
    const id = await vendorId(this.db, u.id);
    return this.db.ledgerEntry.findMany({ where: { vendorId: id }, orderBy: { id: 'desc' }, take: Math.min(Number(limit) || 50, 200) });
  }

  @Roles('ADMIN') @Get('admin/ledger/check')
  check() { return this.ledger.check(); }
}
