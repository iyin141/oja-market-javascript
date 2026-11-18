import { Body, Controller, Get, HttpStatus, Injectable, Param, Post } from '@nestjs/common';
import { Money, couponCreateSchema } from '@oja/shared';
import { Prisma_ } from '../infra/prisma';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { EFFECTIVE_PRICE_SQL } from './catalog';
import { Problem, Z } from '../common/http';

type Tx = Pick<Prisma_, 'coupon'>;

@Injectable()
export class CouponService {
  constructor(private db: Prisma_) {}

  /** Discount in kobo for a cart total, or a Problem explaining why the code cannot be used. Never exceeds the total minus NGN1. */
  async quote(tx: Tx, code: string, total: bigint): Promise<{ code: string; discount: bigint }> {
    const c = await tx.coupon.findUnique({ where: { code } });
    if (!c || !c.active) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Invalid coupon', 'this coupon code does not exist');
    if (c.expiresAt && c.expiresAt < new Date()) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Coupon expired');
    if (c.maxUses !== null && c.usedCount >= c.maxUses) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Coupon used up');
    if (total < c.minSubtotalKobo) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Cart too small', `spend at least ${Money.format(c.minSubtotalKobo)} to use this coupon`);
    const raw = c.kind === 'PERCENT' ? Money.bps(total, Number(c.value)) : c.value;
    const cap = total > 100n ? total - 100n : 0n; // a card charge of zero is not payable, keep at least NGN1
    return { code: c.code, discount: raw > cap ? cap : raw };
  }

  /** Atomic use-count bump: the WHERE clause makes two concurrent checkouts unable to exceed maxUses. */
  async consume(tx: any, code: string) {
    const n: number = await tx.$executeRaw`UPDATE coupons SET used_count = used_count + 1 WHERE code = ${code} AND (max_uses IS NULL OR used_count < max_uses)`;
    if (n !== 1) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Coupon used up');
  }

  create(d: ReturnType<typeof couponCreateSchema.parse>) {
    return this.db.coupon.create({ data: { code: d.code, kind: d.kind, value: d.value, minSubtotalKobo: d.minSubtotalKobo, maxUses: d.maxUses, expiresAt: d.expiresAt } })
      .catch((e: any) => { if (e.code === 'P2002') throw new Problem(HttpStatus.CONFLICT, 'Conflict', 'coupon code already exists'); throw e; });
  }
  list() { return this.db.coupon.findMany({ orderBy: { createdAt: 'desc' } }); }
  async preview(userId: string, code: string) {
    const rows = await this.db.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT coalesce(sum(ci.qty * ${EFFECTIVE_PRICE_SQL}), 0)::bigint AS total FROM cart_items ci JOIN carts c ON c.id = ci.cart_id JOIN variants v ON v.id = ci.variant_id WHERE c.user_id = $1::uuid`, userId);
    const total = rows[0].total;
    const q = await this.quote(this.db, code.toUpperCase(), total);
    return { code: q.code, discountKobo: q.discount, totalKobo: total - q.discount };
  }
}

@Controller()
export class CouponController {
  constructor(private c: CouponService) {}
  @Roles('ADMIN') @Post('admin/coupons') create(@Body(Z(couponCreateSchema)) b: any) { return this.c.create(b); }
  @Roles('ADMIN') @Get('admin/coupons') list() { return this.c.list(); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Get('coupons/:code/preview')
  preview(@Param('code') code: string, @CurrentUser() u: AuthUser) { return this.c.preview(u.id, code); }
}
