import request from 'supertest';
import { randomUUID } from 'crypto';
import { Harness, bearer, boot, ensureDefaultRule, mkCategory, mkProduct, mkUser, mkVendor } from './harness';

let h: Harness;
beforeAll(async () => { h = await boot(); await ensureDefaultRule(h.db); });
afterAll(async () => { await h.close(); });

describe('auth', () => {
  const email = `${randomUUID()}@t.test`;
  let cookie: string[];
  it('register -> /me; duplicate email 409; weak password 400', async () => {
    const r = await request(h.server).post('/auth/register').send({ email, password: 'Passw0rd!x', name: 'A' }).expect(201);
    cookie = r.headers['set-cookie'] as unknown as string[];
    expect(cookie[0]).toMatch(/HttpOnly/i);
    const me = await request(h.server).get('/me').set(bearer(r.body.accessToken)).expect(200);
    expect(me.body.email).toBe(email);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);
    await request(h.server).post('/auth/register').send({ email, password: 'Passw0rd!x', name: 'A' }).expect(409);
    await request(h.server).post('/auth/register').send({ email: 'x@y.test', password: '123', name: 'A' }).expect(400);
  });
  it('refresh rotates; replaying the old token revokes the family', async () => {
    const r1 = await request(h.server).post('/auth/refresh').set('Cookie', cookie).expect(201);
    const cookie2 = r1.headers['set-cookie'] as unknown as string[];
    expect(cookie2[0].split(';')[0]).not.toBe(cookie[0].split(';')[0]);
    await request(h.server).post('/auth/refresh').set('Cookie', cookie).expect(401); // reuse
    await request(h.server).post('/auth/refresh').set('Cookie', cookie2).expect(401); // family revoked
  });
  it('login failures lock the account after 5 attempts', async () => {
    const e = `${randomUUID()}@t.test`;
    await request(h.server).post('/auth/register').send({ email: e, password: 'Passw0rd!x', name: 'L' }).expect(201);
    for (let i = 0; i < 5; i++) await request(h.server).post('/auth/login').send({ email: e, password: 'wrong' }).expect(401);
    await request(h.server).post('/auth/login').send({ email: e, password: 'Passw0rd!x' }).expect(429);
  });
  it('rejects missing, garbage and expired tokens', async () => {
    await request(h.server).get('/me').expect(401);
    await request(h.server).get('/me').set(bearer('garbage')).expect(401);
    const jwt = await import('jsonwebtoken');
    const old = jwt.sign({ role: 'ADMIN' }, process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me-0123456789', { subject: randomUUID(), expiresIn: -10 });
    await request(h.server).get('/me').set(bearer(old)).expect(401);
    const none = jwt.sign({ role: 'ADMIN' }, '', { algorithm: 'none' as any, subject: randomUUID() });
    await request(h.server).get('/me').set(bearer(none)).expect(401);
  });
});

describe('RBAC matrix: 0 unauthorised successes', () => {
  const U = '00000000-0000-4000-8000-000000000001';
  // method, path, allowed roles (anything else must get 401/403; anonymous always 401)
  const routes: [string, string, string[]][] = [
    ['get', '/me', ['CUSTOMER', 'VENDOR', 'ADMIN', 'AGENT']],
    ['get', '/cart', ['CUSTOMER', 'VENDOR', 'ADMIN']],
    ['get', '/orders', ['CUSTOMER', 'VENDOR', 'ADMIN']],
    ['get', '/vendors/me', ['VENDOR']],
    ['get', '/vendor/products', ['VENDOR']],
    ['get', '/vendor/orders', ['VENDOR']],
    ['get', '/vendor/balance', ['VENDOR']],
    ['get', '/vendor/transactions', ['VENDOR']],
    ['get', '/vendor/payouts', ['VENDOR']],
    ['get', '/vendor/returns', ['VENDOR']],
    ['get', '/vendor/inventory/low-stock', ['VENDOR']],
    ['post', `/vendor/orders/${U}/ship`, ['VENDOR']],
    ['post', `/vendor/returns/${U}/respond`, ['VENDOR']],
    ['post', '/vendor/products', ['VENDOR']],
    ['get', '/admin/kpis', ['ADMIN']],
    ['get', '/admin/vendors', ['ADMIN']],
    ['get', '/admin/products', ['ADMIN']],
    ['get', '/admin/disputes', ['ADMIN']],
    ['get', '/admin/audit', ['ADMIN']],
    ['get', '/admin/commission-rules', ['ADMIN']],
    ['get', '/admin/ledger/check', ['ADMIN']],
    ['put', '/admin/commission-rules', ['ADMIN']],
    ['post', '/admin/payouts/run', ['ADMIN']],
    ['post', `/admin/vendors/${U}/approve`, ['ADMIN']],
    ['post', `/admin/vendors/${U}/reject`, ['ADMIN']],
    ['post', `/admin/products/${U}/approve`, ['ADMIN']],
    ['post', `/admin/disputes/${U}/decide`, ['ADMIN']],
    ['post', '/admin/flash-sales', ['ADMIN']],
    ['post', `/agent/sub-orders/${U}/deliver`, ['AGENT', 'ADMIN']],
  ];
  const roles = ['CUSTOMER', 'VENDOR', 'ADMIN', 'AGENT'];
  it(`${routes.length} protected routes x (anonymous + 4 roles)`, async () => {
    const tokens: Record<string, string> = {};
    for (const r of roles) tokens[r] = r === "VENDOR" ? (await mkVendor(h.db)).user.token : (await mkUser(h.db, r as any)).token;
    let denied = 0, allowedChecked = 0;
    for (const [m, path, allowed] of routes) {
      const anon = await (request(h.server) as any)[m](path).send({});
      expect(anon.status).toBe(401); denied++;
      for (const role of roles) {
        const res = await (request(h.server) as any)[m](path).set(bearer(tokens[role])).send({});
        if (allowed.includes(role)) { const guardDenied = res.status === 401 || res.status === 403; if (guardDenied) console.error("RBAC-BAD", m, path, role, res.status); expect(guardDenied).toBe(false); allowedChecked++; }
        else { expect(res.status).toBe(403); denied++; }
      }
    }
    console.log(`RBAC: ${routes.length} routes, ${denied} denied-as-expected, ${allowedChecked} allowed-reach-handler, 0 unauthorised successes`);
  });
  it('customers cannot read other customers\' orders; vendors cannot edit other vendors\' products', async () => {
    const a = await mkUser(h.db), b = await mkUser(h.db);
    const o = await h.db.order.create({ data: { userId: a.id, totalKobo: 1n, expiresAt: new Date() } });
    await request(h.server).get(`/orders/${o.id}`).set(bearer(b.token)).expect(404);
    await request(h.server).get(`/orders/${o.id}`).set(bearer(a.token)).expect(200);
    const v1 = await mkVendor(h.db), v2 = await mkVendor(h.db); const cat = await mkCategory(h.db);
    const p = await mkProduct(h.db, v1.vendor.id, cat.id, 100n, 1);
    await request(h.server).patch(`/vendor/products/${p.product.id}`).set(bearer(v2.user.token)).send({ title: 'hijack' }).expect(404);
    await request(h.server).patch(`/vendor/variants/${p.variant.id}`).set(bearer(v2.user.token)).send({ priceKobo: 1 }).expect(404);
  });
});

describe('vendor onboarding -> catalog -> upload safety -> search', () => {
  it('apply, KYC, admin approve, create product, image happy path, review/active, search finds it', async () => {
    const cust = await mkUser(h.db); const admin = await mkUser(h.db, 'ADMIN'); const cat = await mkCategory(h.db, 800);
    const ap = await request(h.server).post('/vendors/apply').set(bearer(cust.token)).send({ storeName: 'Zeta Gadgets' }).expect(201);
    const vt = ap.body.accessToken as string;
    await request(h.server).post('/vendor/products').set(bearer(vt)).send({ title: 'Early Bird', categoryId: cat.id, variants: [{ sku: 'E-' + randomUUID(), priceKobo: '1000', stock: 1 }] }).expect(403); // not approved
    const up = await request(h.server).patch('/vendors/me/kyc').set(bearer(vt)).send({ contentType: 'application/pdf', size: 1000 }).expect(200);
    await request(h.server).patch('/vendors/me/kyc').set(bearer(vt)).send({ contentType: 'application/x-msdownload', size: 1000 }).expect(422);
    await request(h.server).patch('/vendors/me/kyc').set(bearer(vt)).send({ contentType: 'application/pdf', size: 99_000_000 }).expect(422);
    await request(h.server).patch('/vendors/me/kyc').set(bearer(vt)).send({ docKey: up.body.key }).expect(422); // not uploaded yet
    await h.storage.putBytes('oja-private', up.body.key, Buffer.from('%PDF-1.4'), 'application/pdf');
    await request(h.server).patch('/vendors/me/kyc').set(bearer(vt)).send({ docKey: up.body.key }).expect(200);
    const me = await request(h.server).get('/vendors/me').set(bearer(vt)).expect(200);
    await request(h.server).post(`/admin/vendors/${me.body.id}/reject`).set(bearer(admin.token)).send({ note: 'blurry' }).expect(201);
    await request(h.server).post(`/admin/vendors/${me.body.id}/approve`).set(bearer(admin.token)).expect(409); // REJECTED -> APPROVED illegal
    await request(h.server).patch('/vendors/me/kyc').set(bearer(vt)).send({ docKey: up.body.key }).expect(200); // resubmit
    await request(h.server).post(`/admin/vendors/${me.body.id}/approve`).set(bearer(admin.token)).expect(201);

    const unique = 'Quasar' + randomUUID().slice(0, 6);
    const pr = await request(h.server).post('/vendor/products').set(bearer(vt)).send({ title: `${unique} Headphones`, description: 'noise cancelling', categoryId: cat.id, variants: [{ sku: 'Q-' + randomUUID(), priceKobo: '2500000', stock: 7 }] }).expect(201);
    const pid = pr.body.id as string;
    await request(h.server).get(`/products/${pid}`).expect(404); // draft is invisible
    // illegal: vendor cannot jump to ACTIVE
    await request(h.server).patch(`/vendor/products/${pid}`).set(bearer(vt)).send({ status: 'ACTIVE' }).expect(400);
    // upload safety
    await request(h.server).post(`/vendor/products/${pid}/images/presign`).set(bearer(vt)).send({ contentType: 'application/x-sh', size: 10, filename: 'a.sh' }).expect(400);
    await request(h.server).post(`/vendor/products/${pid}/images/presign`).set(bearer(vt)).send({ contentType: 'image/png', size: 6_000_000, filename: 'big.png' }).expect(400);
    const ps = await request(h.server).post(`/vendor/products/${pid}/images/presign`).set(bearer(vt)).send({ contentType: 'image/png', size: 100, filename: 'ok.png' }).expect(201);
    expect(ps.body.expiresInSec).toBe(300);
    await request(h.server).post(`/vendor/products/${pid}/images/${ps.body.imageId}/confirm`).set(bearer(vt)).expect(422); // nothing uploaded
    // extension/MIME spoof: declared png, bytes are a shell script
    await h.storage.putBytes('oja-public', ps.body.key, Buffer.from('#!/bin/sh\nrm -rf /\n'), 'image/png');
    await request(h.server).post(`/vendor/products/${pid}/images/${ps.body.imageId}/confirm`).set(bearer(vt)).expect(422);
    expect((await h.db.productImage.findUniqueOrThrow({ where: { id: ps.body.imageId } })).status).toBe('REJECTED');
    // real PNG via sharp
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c00' } }).png().toBuffer();
    const ps2 = await request(h.server).post(`/vendor/products/${pid}/images/presign`).set(bearer(vt)).send({ contentType: 'image/png', size: png.length, filename: 'ok.png' }).expect(201);
    await h.storage.putBytes('oja-public', ps2.body.key, png, 'image/png');
    await request(h.server).post(`/vendor/products/${pid}/images/${ps2.body.imageId}/confirm`).set(bearer(vt)).expect(201);
    expect(h.jobs.calls.some((c) => c.name === 'image' && c.args[0] === ps2.body.imageId)).toBe(true);
    const { ImageProcessor } = await import('../src/modules/images');
    await h.app.get(ImageProcessor).process(ps2.body.imageId);
    expect((await h.db.productImage.findUniqueOrThrow({ where: { id: ps2.body.imageId } })).status).toBe('READY');
    const thumbKey = ps2.body.key.replace('raw/', 'products/') + '-320.webp';
    const meta = await sharp(await h.storage.getBytes('oja-public', thumbKey)).metadata();
    expect(meta.format).toBe('webp');
    expect(h.storage.objects.has('oja-public/' + ps2.body.key)).toBe(false); // raw removed

    await request(h.server).patch(`/vendor/products/${pid}`).set(bearer(vt)).send({ status: 'REVIEW' }).expect(200);
    await request(h.server).post(`/admin/products/${pid}/approve`).set(bearer(admin.token)).expect(201);
    const det = await request(h.server).get(`/products/${pid}`).expect(200);
    expect(det.body.variants[0].available).toBe(7);
    expect(det.body.images).toHaveLength(1);

    // search: full-text, prefix, typo (trigram), facets, filters
    const s1 = await request(h.server).get('/search').query({ q: unique }).expect(200);
    expect(s1.body.items.map((i: any) => i.id)).toContain(pid);
    expect(s1.body.facets.categories.length).toBeGreaterThan(0);
    const s2 = await request(h.server).get('/search').query({ q: unique.slice(0, 5) + ' head' }).expect(200);
    expect(s2.body.items.map((i: any) => i.id)).toContain(pid);
    const s3 = await request(h.server).get('/search').query({ q: unique.replace('a', 'e') }).expect(200);
    expect(s3.body.items.map((i: any) => i.id)).toContain(pid);
    const s4 = await request(h.server).get('/search').query({ q: unique, minPrice: '3000000' }).expect(200);
    expect(s4.body.items).toHaveLength(0);
    await request(h.server).get('/search').query({ q: "'; DROP TABLE products;--" }).expect(200);
  });

  it('flash sale price wins inside window; cart flags price drift', async () => {
    const v = await mkVendor(h.db); const cat = await mkCategory(h.db, 1000);
    const p = await mkProduct(h.db, v.vendor.id, cat.id, 100000n, 5);
    const u = await mkUser(h.db);
    await request(h.server).post('/cart/items').set(bearer(u.token)).send({ variantId: p.variant.id, qty: 2 }).expect(201);
    await h.db.flashSale.create({ data: { variantId: p.variant.id, priceKobo: 60000n, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 3600_000) } });
    const cart = await request(h.server).get('/cart').set(bearer(u.token)).expect(200);
    expect(cart.body.groups).toHaveLength(1);
    expect(cart.body.groups[0].items[0]).toMatchObject({ unitPriceKobo: '60000', addedPriceKobo: '100000', priceChanged: true });
    expect(cart.body.totalKobo).toBe('120000');
  });
});
