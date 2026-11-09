import { Body, Controller, Delete, Get, HttpStatus, Injectable, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Prisma_ } from '../infra/prisma';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { Problem, Z } from '../common/http';
import { EFFECTIVE_PRICE_SQL } from './catalog';

@Injectable()
export class CartService {
  constructor(private db: Prisma_) {}

  private async cartId(userId: string) {
    const c = await this.db.cart.upsert({ where: { userId }, update: {}, create: { userId } });
    return c.id;
  }

  /** Cart grouped by vendor with live prices; `priceChanged` flags drift since the item was added. */
  async get(userId: string) {
    const id = await this.cartId(userId);
    const rows = await this.db.$queryRawUnsafe<any[]>(
      `SELECT ci.variant_id AS "variantId", ci.qty, ci.unit_price_kobo AS "addedPriceKobo", ${EFFECTIVE_PRICE_SQL} AS "unitPriceKobo",
        p.id AS "productId", p.title, p.slug, p.status, vp.id AS "vendorId", vp.store_name AS "vendorName", i.on_hand - i.reserved AS available
       FROM cart_items ci JOIN variants v ON v.id = ci.variant_id JOIN products p ON p.id = v.product_id JOIN vendor_profiles vp ON vp.id = p.vendor_id
       LEFT JOIN inventory i ON i.variant_id = v.id WHERE ci.cart_id = $1::uuid ORDER BY vp.store_name, p.title`, id);
    const groups = new Map<string, any>();
    let total = 0n;
    for (const r of rows) {
      const g = groups.get(r.vendorId) ?? { vendorId: r.vendorId, vendorName: r.vendorName, items: [], subtotalKobo: 0n };
      const line = r.unitPriceKobo * BigInt(r.qty);
      g.items.push({ ...r, lineKobo: line, priceChanged: r.unitPriceKobo !== r.addedPriceKobo, unavailable: r.status !== 'ACTIVE' || r.available < r.qty });
      g.subtotalKobo += line; total += line;
      groups.set(r.vendorId, g);
    }
    return { groups: [...groups.values()], totalKobo: total };
  }

  private async priceOf(variantId: string) {
    const [r] = await this.db.$queryRawUnsafe<{ price: bigint; status: string }[]>(
      `SELECT ${EFFECTIVE_PRICE_SQL} AS price, p.status FROM variants v JOIN products p ON p.id = v.product_id JOIN vendor_profiles vp ON vp.id = p.vendor_id WHERE v.id = $1::uuid AND vp.status = 'APPROVED'`, variantId);
    if (!r || r.status !== 'ACTIVE') throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'variant not available');
    return r.price;
  }

  async add(userId: string, variantId: string, qty: number) {
    const price = await this.priceOf(variantId);
    const cartId = await this.cartId(userId);
    await this.db.$executeRaw`INSERT INTO cart_items (id, cart_id, variant_id, qty, unit_price_kobo) VALUES (gen_random_uuid(), ${cartId}::uuid, ${variantId}::uuid, ${qty}, ${price})
      ON CONFLICT (cart_id, variant_id) DO UPDATE SET qty = LEAST(cart_items.qty + ${qty}, 99), unit_price_kobo = ${price}`;
    return this.get(userId);
  }

  /** Replace the whole cart. qty 0 drops a line. */
  async put(userId: string, items: { variantId: string; qty: number }[]) {
    const cartId = await this.cartId(userId);
    const prices = new Map<string, bigint>();
    for (const i of items.filter((i) => i.qty > 0)) prices.set(i.variantId, await this.priceOf(i.variantId));
    await this.db.$transaction([
      this.db.cartItem.deleteMany({ where: { cartId } }),
      this.db.cartItem.createMany({ data: items.filter((i) => i.qty > 0).map((i) => ({ cartId, variantId: i.variantId, qty: i.qty, unitPriceKobo: prices.get(i.variantId)! })) }),
    ]);
    return this.get(userId);
  }

  async remove(userId: string, variantId: string) {
    await this.db.cartItem.deleteMany({ where: { cart: { userId }, variantId } });
    return this.get(userId);
  }
}

const line = z.object({ variantId: z.string().uuid(), qty: z.number().int().min(0).max(99) });
@Controller('cart')
export class CartController {
  constructor(private c: CartService) {}
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Get() get(@CurrentUser() u: AuthUser) { return this.c.get(u.id); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Put() put(@CurrentUser() u: AuthUser, @Body(Z(z.object({ items: z.array(line).max(100) }))) b: any) { return this.c.put(u.id, b.items); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Post('items') add(@CurrentUser() u: AuthUser, @Body(Z(line.extend({ qty: z.number().int().min(1).max(99) }))) b: any) { return this.c.add(u.id, b.variantId, b.qty); }
  @Roles('CUSTOMER', 'VENDOR', 'ADMIN') @Delete('items/:variantId') remove(@CurrentUser() u: AuthUser, @Param('variantId') v: string) { return this.c.remove(u.id, v); }
}
