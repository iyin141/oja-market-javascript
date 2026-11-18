import request from 'supertest';
import { randomUUID } from 'crypto';
import { Harness, bearer, boot, ensureDefaultRule, fillCart, mkCategory, mkProduct, mkUser, mkVendor } from './harness';
import { textPdf } from '../src/modules/invoices';

let h: Harness;
beforeAll(async () => { h = await boot(); await ensureDefaultRule(h.db); });
afterAll(async () => { await h.close(); });

const checkout = (token: string, body: object = {}) =>
  request(h.server).post('/checkout').set(bearer(token)).set('Idempotency-Key', randomUUID()).send(body);
const code = () => 'T' + randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

async function twoVendorCart(priceA = 1000000n, priceB = 500000n) {
  const a = await mkVendor(h.db), b = await mkVendor(h.db);
  const cat = await mkCategory(h.db, 1000);
  const pa = await mkProduct(h.db, a.vendor.id, cat.id, priceA, 20), pb = await mkProduct(h.db, b.vendor.id, cat.id, priceB, 20);
  const u = await mkUser(h.db);
  await fillCart(h.db, u.id, [{ variantId: pa.variant.id, qty: 1, price: 1n }, { variantId: pb.variant.id, qty: 1, price: 1n }]);
  return { a, b, u };
}

describe('coupons', () => {
  it('percent coupon: discount shared pro rata, commission on the net, ledger still balances after payment', async () => {
    const admin = await mkUser(h.db, 'ADMIN');
    const c = code();
    await request(h.server).post('/admin/coupons').set(bearer(admin.token)).send({ code: c, kind: 'PERCENT', value: 1000 }).expect(201);
    const { u } = await twoVendorCart();
    const prev = await request(h.server).get(`/coupons/${c}/preview`).set(bearer(u.token)).expect(200);
    expect(prev.body.discountKobo).toBe('150000'); expect(prev.body.totalKobo).toBe('1350000');

    const r = await checkout(u.token, { couponCode: c.toLowerCase() }).expect(201);
    expect(r.body.totalKobo).toBe('1350000');
    const o = await h.db.order.findUniqueOrThrow({ where: { id: r.body.orderId }, include: { subOrders: true } });
    expect(o.discountKobo).toBe(150000n); expect(o.couponCode).toBe(c);
    expect(o.subOrders.reduce((s, x) => s + x.discountKobo, 0n)).toBe(150000n);
    expect(o.subOrders.reduce((s, x) => s + x.subtotalKobo, 0n)).toBe(1350000n); // sub-orders add up to what the customer pays
    for (const s of o.subOrders) expect(s.commissionKobo).toBe((s.subtotalKobo * 1000n + 5000n) / 10000n); // 10% of net
    expect((await h.db.coupon.findUniqueOrThrow({ where: { code: c } })).usedCount).toBe(1);

    const { body, signature } = h.pay.buildChargeSuccess({ eventId: 'evt-' + o.id, reference: o.id, amountKobo: o.totalKobo });
    await request(h.server).post('/payments/webhook').set('x-paystack-signature', signature).set('content-type', 'application/json').send(body.toString()).expect(200);
    const [l] = await h.db.$queryRaw<{ total_debits: bigint; total_credits: bigint; unbalanced_groups: bigint }[]>`SELECT * FROM ledger_check`;
    expect(l.total_debits).toBe(l.total_credits); expect(l.unbalanced_groups).toBe(0n);
  });

  it('fixed coupon is capped so the card charge is never zero; minimum spend, expiry and unknown codes are refused', async () => {
    const admin = await mkUser(h.db, 'ADMIN');
    const big = code(), min = code(), old = code();
    await request(h.server).post('/admin/coupons').set(bearer(admin.token)).send({ code: big, kind: 'FIXED', value: '999999999' }).expect(201);
    await request(h.server).post('/admin/coupons').set(bearer(admin.token)).send({ code: min, kind: 'FIXED', value: 1000, minSubtotalKobo: 99999999 }).expect(201);
    await request(h.server).post('/admin/coupons').set(bearer(admin.token)).send({ code: old, kind: 'FIXED', value: 1000, expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(201);
    const { u } = await twoVendorCart();
    const r = await checkout(u.token, { couponCode: big }).expect(201);
    expect(r.body.totalKobo).toBe('100'); // 1,500,000 minus the cap, NGN1 left to charge
    for (const bad of [min, old, 'NOSUCHCODE']) {
      const { u: u2 } = await twoVendorCart();
      expect((await checkout(u2.token, { couponCode: bad })).status).toBe(422);
    }
  });

  it('maxUses holds under concurrency: 6 parallel checkouts on a 2-use coupon => exactly 2 succeed', async () => {
    const admin = await mkUser(h.db, 'ADMIN');
    const c = code();
    await request(h.server).post('/admin/coupons').set(bearer(admin.token)).send({ code: c, kind: 'FIXED', value: 1000, maxUses: 2 }).expect(201);
    const carts = await Promise.all(Array.from({ length: 6 }, () => twoVendorCart()));
    const res = await Promise.all(carts.map(({ u }) => checkout(u.token, { couponCode: c })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(2);
    expect(res.filter((r) => r.status === 422)).toHaveLength(4);
    expect((await h.db.coupon.findUniqueOrThrow({ where: { code: c } })).usedCount).toBe(2);
  });

  it('only admins create coupons', async () => {
    const u = await mkUser(h.db);
    await request(h.server).post('/admin/coupons').set(bearer(u.token)).send({ code: code(), kind: 'FIXED', value: 1 }).expect(403);
    await request(h.server).get('/admin/coupons').expect(401);
  });
});

describe('PDF invoice', () => {
  it('owner downloads a valid PDF with the discount line; another customer gets 404', async () => {
    const admin = await mkUser(h.db, 'ADMIN'); const c = code();
    await request(h.server).post('/admin/coupons').set(bearer(admin.token)).send({ code: c, kind: 'PERCENT', value: 1000 }).expect(201);
    const { u } = await twoVendorCart();
    const r = await checkout(u.token, { couponCode: c }).expect(201);
    const res = await request(h.server).get(`/orders/${r.body.orderId}/invoice`).set(bearer(u.token)).buffer(true).parse((resp, cb) => { const d: Buffer[] = []; resp.on('data', (x: Buffer) => d.push(x)); resp.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 8).toString()).toBe('%PDF-1.4');
    expect(pdf.toString('latin1')).toContain('TOTAL');
    expect(pdf.toString('latin1')).toContain(`Discount \\(${c}\\)`); // parentheses are escaped in PDF strings
    const other = await mkUser(h.db);
    await request(h.server).get(`/orders/${r.body.orderId}/invoice`).set(bearer(other.token)).expect(404);
    await request(h.server).get(`/orders/${r.body.orderId}/invoice`).set(bearer(admin.token)).expect(200);
  });

  it('textPdf escapes parentheses and paginates', () => {
    const pdf = textPdf(Array.from({ length: 120 }, (_, i) => ({ text: `line ${i} (x) \\ y` }))).toString('latin1');
    expect(pdf).toContain('/Count 3');
    expect(pdf).toContain('line 0 \\(x\\) \\\\ y');
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
  });
});

describe('admin analytics', () => {
  it('returns a day-by-day series with no gaps, leaderboards, and is admin only', async () => {
    const admin = await mkUser(h.db, 'ADMIN');
    const res = await request(h.server).get('/admin/analytics?days=7').set(bearer(admin.token)).expect(200);
    expect(res.body.daily).toHaveLength(7);
    expect(Array.isArray(res.body.topVendors)).toBe(true);
    expect(res.body.coupons).toHaveProperty('orders_with_coupon');
    const u = await mkUser(h.db);
    await request(h.server).get('/admin/analytics').set(bearer(u.token)).expect(403);
  });
});

describe('Redis caching', () => {
  it('cart: second read is served from Redis, writes and checkout drop the key', async () => {
    const { a } = await twoVendorCart();
    const cat = await mkCategory(h.db);
    const p = await mkProduct(h.db, a.vendor.id, cat.id, 100000n, 10);
    const u = await mkUser(h.db);
    const key = `cart:${u.id}`;
    await request(h.server).post('/cart/items').set(bearer(u.token)).send({ variantId: p.variant.id, qty: 2 }).expect(201);
    expect(await h.redis.ttl(key)).toBeGreaterThan(0); // the mutation response is rebuilt and cached
    const first = await request(h.server).get('/cart').set(bearer(u.token)).expect(200);
    expect(await h.redis.ttl(key)).toBeGreaterThan(0);
    // prove the read comes from Redis: tamper with the cached copy, the API must return it
    const cached = JSON.parse((await h.redis.get(key))!); cached.totalKobo = '777';
    await h.redis.set(key, JSON.stringify(cached), 'EX', 30);
    expect((await request(h.server).get('/cart').set(bearer(u.token)).expect(200)).body.totalKobo).toBe('777');
    // write path invalidates
    await request(h.server).put('/cart').set(bearer(u.token)).send({ items: [{ variantId: p.variant.id, qty: 1 }] }).expect(200);
    expect((await request(h.server).get('/cart').set(bearer(u.token)).expect(200)).body.totalKobo).toBe('100000');
    expect(first.body.totalKobo).toBe('200000');
    // checkout empties the cart and the cached copy
    await checkout(u.token).expect(201);
    expect(await h.redis.get(key)).toBeNull();
    expect((await request(h.server).get('/cart').set(bearer(u.token)).expect(200)).body.groups).toHaveLength(0);
  });

  it('/me: cached for the session, dropped when the profile changes', async () => {
    const u = await mkUser(h.db);
    await request(h.server).get('/me').set(bearer(u.token)).expect(200);
    expect(await h.redis.ttl(`me:${u.id}`)).toBeGreaterThan(0);
    await request(h.server).patch('/me').set(bearer(u.token)).send({ name: 'Renamed' }).expect(200);
    expect(await h.redis.get(`me:${u.id}`)).toBeNull();
    expect((await request(h.server).get('/me').set(bearer(u.token)).expect(200)).body.name).toBe('Renamed');
  });
});
