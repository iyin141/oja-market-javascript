import { Controller, Get, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma_, Tx } from '../infra/prisma';
import { Problem, counters } from '../common/http';
import { AuthUser, CurrentUser, Roles } from '../common/auth';

export class OutOfStock extends Problem {
  constructor(public variantId: string) { super(HttpStatus.CONFLICT, 'Out of stock', `insufficient stock for variant ${variantId}`, { variantId }); }
}

/**
 * Reserve / commit / release. Correctness rests on single-statement conditional UPDATEs plus the
 * DB CHECK (reserved >= 0 AND on_hand - reserved >= 0); no read-then-write races.
 */
@Injectable()
export class InventoryService {
  constructor(private db: Prisma_) {}

  /** Lines are locked in variant-id order so concurrent multi-line carts cannot deadlock. */
  async reserve(tx: Tx, orderId: string, lines: { variantId: string; qty: number }[], expiresAt: Date) {
    const merged = new Map<string, number>();
    for (const l of lines) merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.qty);
    for (const [variantId, qty] of [...merged].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const n = await tx.$executeRaw`UPDATE inventory SET reserved = reserved + ${qty} WHERE variant_id = ${variantId}::uuid AND on_hand - reserved >= ${qty}`;
      if (n !== 1) { counters.oos.inc(); throw new OutOfStock(variantId); }
      await tx.reservation.create({ data: { orderId, variantId, qty, expiresAt } });
    }
  }

  /** Payment confirmed: reserved stock leaves the shelf. Idempotent (claims ACTIVE rows only). */
  async commit(tx: Tx, orderId: string) {
    const rows = await tx.$queryRaw<{ variant_id: string; qty: number }[]>`UPDATE reservations SET status = 'COMMITTED' WHERE order_id = ${orderId}::uuid AND status = 'ACTIVE' RETURNING variant_id, qty`;
    for (const r of rows) await tx.$executeRaw`UPDATE inventory SET on_hand = on_hand - ${r.qty}, reserved = reserved - ${r.qty} WHERE variant_id = ${r.variant_id}::uuid`;
    return rows.length;
  }

  async release(tx: Tx, orderId: string, status: 'RELEASED' | 'EXPIRED') {
    const rows = await tx.$queryRawUnsafe<{ variant_id: string; qty: number }[]>(
      `UPDATE reservations SET status = '${status}' WHERE order_id = $1::uuid AND status = 'ACTIVE' RETURNING variant_id, qty`, orderId);
    for (const r of rows) await tx.$executeRaw`UPDATE inventory SET reserved = reserved - ${r.qty} WHERE variant_id = ${r.variant_id}::uuid`;
    return rows.length;
  }

  /** Reservation TTL elapsed (or sweep): expire unpaid sub-orders and give stock back. Safe to call repeatedly. */
  async expireOrder(orderId: string) {
    return this.db.$transaction(async (tx) => {
      const n = await tx.$executeRaw`UPDATE sub_orders SET status = 'EXPIRED' WHERE order_id = ${orderId}::uuid AND status = 'PENDING_PAYMENT'`;
      if (n === 0) return 0;
      return this.release(tx, orderId, 'EXPIRED');
    });
  }

  /** Safety net if Redis lost the delayed job: sweeps overdue unpaid orders. */
  async sweepExpired() {
    const rows = await this.db.$queryRaw<{ order_id: string }[]>`SELECT DISTINCT r.order_id FROM reservations r JOIN sub_orders s ON s.order_id = r.order_id WHERE r.status = 'ACTIVE' AND r.expires_at < now() AND s.status = 'PENDING_PAYMENT'`;
    for (const r of rows) await this.expireOrder(r.order_id);
    return rows.length;
  }

  async lowStock(vendorId: string, threshold = 5) {
    return this.db.$queryRaw`SELECT v.id AS "variantId", v.sku, p.title, i.on_hand - i.reserved AS available FROM inventory i JOIN variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id WHERE p.vendor_id = ${vendorId}::uuid AND i.on_hand - i.reserved <= ${threshold} ORDER BY available ASC LIMIT 100`;
  }
}

@Controller('vendor/inventory')
export class InventoryController {
  constructor(private inv: InventoryService, private db: Prisma_) {}
  @Roles('VENDOR') @Get('low-stock')
  async low(@CurrentUser() u: AuthUser) {
    const v = await this.db.vendorProfile.findUnique({ where: { userId: u.id } });
    if (!v) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', 'no vendor profile');
    return this.inv.lowStock(v.id);
  }
}
