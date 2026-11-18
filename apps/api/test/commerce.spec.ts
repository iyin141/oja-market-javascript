import request from 'supertest';
import { randomUUID } from 'crypto';
import { Harness, bearer, boot, ensureDefaultRule, fillCart, mkCategory, mkProduct, mkUser, mkVendor } from './harness';

let h: Harness;
beforeAll(async () => { h = await boot(); await ensureDefaultRule(h.db); });
afterAll(async () => { await h.close(); });

const checkout = (token: string, key = randomUUID(), body: object = {}) =>
  request(h.server).post('/checkout').set(bearer(token)).set('Idempotency-Key', key).send(body);

async function ledgerOk() {
  const [r] = await h.db.$queryRaw<{ total_debits: bigint; total_credits: bigint; unbalanced_groups: bigint }[]>`SELECT * FROM ledger_check`;
  return r.total_debits === r.total_credits && r.unbalanced_groups === 0n;
}

describe('oversell: 200 concurrent checkouts on 50 units', () => {
  it('exactly 50 succeed, 0 negative stock', async () => {
    const { vendor } = await mkVendor(h.db); const cat = await mkCategory(h.db);
    const { variant } = await mkProduct(h.db, vendor.id, cat.id, 100000n, 50);
    const users = await Promise.all(Array.from({ length: 200 }, () => mkUser(h.db)));
    for (const u of users) await fillCart(h.db, u.id, [{ variantId: variant.id, qty: 1, price: 100000n }]);
    const t0 = Date.now();
    const res = await Promise.all(users.map((u) => checkout(u.token)));
    const ms = Date.now() - t0;
    const ok = res.filter((r) => r.status === 201 || r.status === 200).length;
    const oos = res.filter((r) => r.status === 409).length;
    const inv = await h.db.inventory.findUniqueOrThrow({ where: { variantId: variant.id } });
    console.log(`OVERSELL: ${ok} succeeded, ${oos} rejected(409) of 200 in ${ms}ms; reserved=${inv.reserved} on_hand=${inv.onHand}`);
    expect(ok).toBe(50);
    expect(oos).toBe(150);
    expect(inv.reserved).toBe(50);
    expect(inv.onHand - inv.reserved).toBe(0);
    expect(await h.db.reservation.count({ where: { variantId: variant.id, status: 'ACTIVE' } })).toBe(50);
  });
});

describe('checkout', () => {
  it('two-vendor cart => one order, two sub-orders, commission snapshot; later rule change does not rewrite', async () => {
    const a = await mkVendor(h.db), b = await mkVendor(h.db);
    const catA = await mkCategory(h.db, 1000), catB = await mkCategory(h.db, 500);
    const pa = await mkProduct(h.db, a.vendor.id, catA.id, 1000000n, 10), pb = await mkProduct(h.db, b.vendor.id, catB.id, 250050n, 10);
    const u = await mkUser(h.db);
    await fillCart(h.db, u.id, [{ variantId: pa.variant.id, qty: 2, price: 1n }, { variantId: pb.variant.id, qty: 1, price: 1n }]); // client price ignored
    const r = await checkout(u.token);
    expect(r.status).toBe(201);
    expect(r.body.totalKobo).toBe('2250050');
    const order = await h.db.order.findUniqueOrThrow({ where: { id: r.body.orderId }, include: { subOrders: true } });
    expect(order.subOrders).toHaveLength(2);
    const sa = order.subOrders.find((s) => s.vendorId === a.vendor.id)!, sb = order.subOrders.find((s) => s.vendorId === b.vendor.id)!;
    expect(sa.commissionKobo).toBe(200000n); expect(sa.commissionBps).toBe(1000);
    expect(sb.commissionKobo).toBe(12503n); // 250050 * 5% = 12502.5 -> half up
    expect(r.body.authorizationUrl).toContain('/pay/fake');
    expect(h.jobs.calls.some((c) => c.name === 'release' && c.args[0] === order.id)).toBe(true);
    // rule change affects only new orders
    await h.db.commissionRule.update({ where: { categoryId: catA.id }, data: { bps: 3000 } });
    expect((await h.db.subOrder.findUniqueOrThrow({ where: { id: sa.id } })).commissionKobo).toBe(200000n);
  });

  it('is idempotent on Idempotency-Key (10 parallel => 1 order, same body)', async () => {
    const v = await mkVendor(h.db); const cat = await mkCategory(h.db, 1000);
    const p = await mkProduct(h.db, v.vendor.id, cat.id, 500000n, 100);
    const u = await mkUser(h.db); await fillCart(h.db, u.id, [{ variantId: p.variant.id, qty: 3, price: 500000n }]);
    const key = randomUUID();
    const rs = await Promise.all(Array.from({ length: 10 }, () => checkout(u.token, key)));
    const ids = new Set(rs.filter((r) => r.status < 300).map((r) => r.body.orderId));
    expect(ids.size).toBe(1);
    expect(await h.db.order.count({ where: { userId: u.id } })).toBe(1);
    expect((await h.db.inventory.findUniqueOrThrow({ where: { variantId: p.variant.id } })).reserved).toBe(3);
  });

  it('requires Idempotency-Key', async () => {
    const u = await mkUser(h.db);
    const r = await request(h.server).post('/checkout').set(bearer(u.token)).send({});
    expect(r.status).toBe(400);
    expect(r.headers['content-type']).toContain('application/problem+json');
  });

  it('expiry releases stock and is repeatable', async () => {
    const v = await mkVendor(h.db); const cat = await mkCategory(h.db, 1000);
    const p = await mkProduct(h.db, v.vendor.id, cat.id, 500000n, 5);
    const u = await mkUser(h.db); await fillCart(h.db, u.id, [{ variantId: p.variant.id, qty: 4, price: 500000n }]);
    const r = await checkout(u.token);
    expect((await h.db.inventory.findUniqueOrThrow({ where: { variantId: p.variant.id } })).reserved).toBe(4);
    const { InventoryService } = await import('../src/modules/inventory');
    const inv = h.app.get(InventoryService);
    expect(await inv.expireOrder(r.body.orderId)).toBe(1);
    expect(await inv.expireOrder(r.body.orderId)).toBe(0);
    expect((await h.db.inventory.findUniqueOrThrow({ where: { variantId: p.variant.id } })).reserved).toBe(0);
    expect((await h.db.subOrder.findFirstOrThrow({ where: { orderId: r.body.orderId } })).status).toBe('EXPIRED');
  });

  it('COD: limit enforced, no ledger until agent collects cash', async () => {
    const v = await mkVendor(h.db); const cat = await mkCategory(h.db, 1000);
    const big = await mkProduct(h.db, v.vendor.id, cat.id, 20000000n, 5), small = await mkProduct(h.db, v.vendor.id, cat.id, 100000n, 5);
    const u = await mkUser(h.db);
    await fillCart(h.db, u.id, [{ variantId: big.variant.id, qty: 1, price: 1n }]);
    expect((await checkout(u.token, randomUUID(), { paymentMethod: 'COD' })).status).toBe(422);
    await fillCart(h.db, u.id, [{ variantId: small.variant.id, qty: 1, price: 1n }]);
    const r = await checkout(u.token, randomUUID(), { paymentMethod: 'COD' });
    expect(r.status).toBe(201); expect(r.body.status).toBe('AWAITING_COLLECTION');
    const so = await h.db.subOrder.findFirstOrThrow({ where: { orderId: r.body.orderId } });
    expect(await h.db.ledgerEntry.count({ where: { subOrderId: so.id } })).toBe(0);
    const agent = await mkUser(h.db, 'AGENT');
    await request(h.server).post(`/vendor/orders/${so.id}/ship`).set(bearer(v.user.token)).send({ courier: 'GIG', trackingNo: 'T123' }).expect(201);
    await request(h.server).post(`/agent/sub-orders/${so.id}/deliver`).set(bearer(agent.token)).send({ cashCollected: false }).expect(409);
    await request(h.server).post(`/agent/sub-orders/${so.id}/deliver`).set(bearer(agent.token)).send({ cashCollected: true }).expect(201);
    await request(h.server).post(`/agent/sub-orders/${so.id}/deliver`).set(bearer(agent.token)).send({ cashCollected: true }).expect(409);
    expect(await h.db.ledgerEntry.count({ where: { subOrderId: so.id } })).toBe(3);
    expect(await ledgerOk()).toBe(true);
  });
});

describe('payments + ledger', () => {
  async function paidOrder(price = 1000000n, qty = 1) {
    const v = await mkVendor(h.db); const cat = await mkCategory(h.db, 1000);
    const p = await mkProduct(h.db, v.vendor.id, cat.id, price, 20);
    const u = await mkUser(h.db); await fillCart(h.db, u.id, [{ variantId: p.variant.id, qty, price }]);
    const r = await checkout(u.token);
    return { v, u, p, orderId: r.body.orderId as string, total: BigInt(r.body.totalKobo) };
  }
  const hook = (body: Buffer, sig: string) => request(h.server).post('/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(body.toString('utf8'));

  it('same webhook x20 concurrently => 1 payment row paid, 1 ledger set, stock committed once', async () => {
    const o = await paidOrder(1000000n, 2);
    const { body, signature } = h.pay.buildChargeSuccess({ eventId: 'evt-' + o.orderId, reference: o.orderId, amountKobo: o.total });
    const rs = await Promise.all(Array.from({ length: 20 }, () => hook(body, signature)));
    const statuses = rs.map((r) => r.body.status);
    console.log('WEBHOOK x20:', JSON.stringify(statuses.reduce((a: any, s) => ((a[s] = (a[s] ?? 0) + 1), a), {})));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(statuses.filter((s) => s === 'posted')).toHaveLength(1);
    expect(await h.db.paymentEvent.count({ where: { eventId: 'evt-' + o.orderId } })).toBe(1);
    expect(await h.db.payment.count({ where: { orderId: o.orderId, status: 'PAID' } })).toBe(1);
    const so = await h.db.subOrder.findFirstOrThrow({ where: { orderId: o.orderId } });
    expect(so.status).toBe('PAID');
    const entries = await h.db.ledgerEntry.findMany({ where: { subOrderId: so.id } });
    expect(entries).toHaveLength(5); // gateway Dr, vendor Cr, commission Cr, fee Dr, gateway Cr
    const sum = (d: string) => entries.filter((e) => e.direction === d).reduce((s, e) => s + e.amountKobo, 0n);
    expect(sum('DEBIT')).toBe(sum('CREDIT'));
    expect(sum('DEBIT')).toBe(2000000n + so.feeKobo);
    const inv = await h.db.inventory.findUniqueOrThrow({ where: { variantId: o.p.variant.id } });
    expect(inv.onHand).toBe(18); expect(inv.reserved).toBe(0);
    expect(await ledgerOk()).toBe(true);
    // different event id for the same reference after payment => no second posting
    const again = h.pay.buildChargeSuccess({ eventId: 'evt2-' + o.orderId, reference: o.orderId, amountKobo: o.total });
    expect((await hook(again.body, again.signature)).body.status).toBe('already_paid');
    expect(await h.db.ledgerEntry.count({ where: { subOrderId: so.id } })).toBe(5);
  });

  it('tampered body / bad signature rejected with 401, nothing recorded', async () => {
    const o = await paidOrder();
    const { body, signature } = h.pay.buildChargeSuccess({ eventId: 'evt-t-' + o.orderId, reference: o.orderId, amountKobo: o.total });
    expect((await hook(Buffer.from(body.toString().replace(o.total.toString(), '1')), signature)).status).toBe(401);
    expect((await hook(body, 'abc')).status).toBe(401);
    expect((await request(h.server).post('/payments/webhook').send(body)).status).toBe(401);
    expect(await h.db.paymentEvent.count({ where: { reference: o.orderId } })).toBe(0);
  });

  it('wrong amount is not posted', async () => {
    const o = await paidOrder();
    const { body, signature } = h.pay.buildChargeSuccess({ eventId: 'evt-m-' + o.orderId, reference: o.orderId, amountKobo: o.total - 1n });
    expect((await hook(body, signature)).body.status).toBe('mismatch');
    expect((await h.db.subOrder.findFirstOrThrow({ where: { orderId: o.orderId } })).status).toBe('PENDING_PAYMENT');
  });

  it('ledger rows cannot be updated or deleted (trigger + app role), unbalanced group rejected', async () => {
    const o = await paidOrder();
    const { body, signature } = h.pay.buildChargeSuccess({ eventId: 'evt-l-' + o.orderId, reference: o.orderId, amountKobo: o.total });
    await hook(body, signature);
    await expect(h.db.$executeRaw`UPDATE ledger_entries SET amount_kobo = 1`).rejects.toThrow();
    await expect(h.db.$executeRaw`DELETE FROM ledger_entries`).rejects.toThrow();
    await expect(h.db.$executeRaw`UPDATE payment_events SET type = 'x'`).rejects.toThrow();
    await expect(h.db.ledgerEntry.create({ data: { groupId: randomUUID(), account: 'x', direction: 'DEBIT', amountKobo: 5n, ref: 'bad' } })).rejects.toThrow(/unbalanced/);
  });

  it('property: ledger balances for random mixes of orders, fees and amounts', async () => {
    for (let i = 0; i < 12; i++) {
      const price = BigInt(1000 + Math.floor(Math.random() * 9_000_000));
      const o = await paidOrder(price, 1 + Math.floor(Math.random() * 5));
      const { body, signature } = h.pay.buildChargeSuccess({ eventId: `evt-p-${o.orderId}`, reference: o.orderId, amountKobo: o.total });
      await hook(body, signature);
    }
    expect(await ledgerOk()).toBe(true);
    const per = await h.db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM (SELECT sub_order_id FROM ledger_entries WHERE sub_order_id IS NOT NULL GROUP BY sub_order_id HAVING sum(amount_kobo) FILTER (WHERE direction='DEBIT') <> sum(amount_kobo) FILTER (WHERE direction='CREDIT')) x`;
    expect(per[0].n).toBe(0n);
  });

  it('full lifecycle: ship, deliver, dispute moves balance to hold and back; refund reverses', async () => {
    const admin = await mkUser(h.db, 'ADMIN'); const agent = await mkUser(h.db, 'AGENT');
    const run = async (decision: 'REFUND' | 'REJECT') => {
      const o = await paidOrder(1000000n, 1);
      const { body, signature } = h.pay.buildChargeSuccess({ eventId: `evt-d-${o.orderId}`, reference: o.orderId, amountKobo: o.total });
      await hook(body, signature);
      const so = await h.db.subOrder.findFirstOrThrow({ where: { orderId: o.orderId } });
      const bal = async () => (await request(h.server).get('/vendor/balance').set(bearer(o.v.user.token)).expect(200)).body;
      expect((await bal()).pendingKobo).toBe('900000');
      await request(h.server).post(`/vendor/orders/${so.id}/ship`).set(bearer(o.v.user.token)).send({ courier: 'DHL', trackingNo: 'TRK1' }).expect(201);
      await request(h.server).post(`/orders/${o.orderId}/events`).set(bearer(o.u.token)).send({ type: 'CONFIRM_DELIVERY' }).expect(201);
      await request(h.server).post(`/orders/${o.orderId}/returns`).set(bearer(o.u.token)).send({ subOrderId: so.id, reason: 'arrived damaged' }).expect(201);
      expect(await bal()).toMatchObject({ pendingKobo: '0', holdKobo: '900000' });
      const ret = await h.db.returnRequest.findFirstOrThrow({ where: { subOrderId: so.id } });
      await request(h.server).post(`/vendor/returns/${ret.id}/respond`).set(bearer(o.v.user.token)).send({ accept: false, note: 'item was fine' }).expect(201);
      await request(h.server).post(`/admin/disputes/${ret.id}/decide`).set(bearer(admin.token)).send({ decision }).expect(201);
      const after = await bal();
      if (decision === 'REJECT') {
        expect(after).toMatchObject({ pendingKobo: '900000', holdKobo: '0' });
        expect((await h.db.subOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe('DELIVERED');
        // hold period over => settle moves pending -> available, payout drains it exactly once
        await h.db.$executeRaw`UPDATE sub_orders SET delivered_at = now() - interval '8 days' WHERE id = ${so.id}::uuid`;
        const { OrdersService } = await import('../src/modules/orders');
        expect(await h.app.get(OrdersService).settleDue()).toBeGreaterThanOrEqual(1);
        expect(await bal()).toMatchObject({ pendingKobo: '0', availableKobo: '900000' });
        const key = 'run-' + randomUUID();
        // no payout recipient: skipped, not settled in the ledger
        const p0 = await request(h.server).post('/admin/payouts/run').set(bearer(admin.token)).send({ runKey: key + '-none' }).expect(200);
        expect(p0.body.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ vendorId: o.v.vendor.id, reason: 'no payout recipient' })]));
        expect(await bal()).toMatchObject({ availableKobo: '900000', paidOutKobo: '0' });
        await h.db.vendorProfile.update({ where: { id: o.v.vendor.id }, data: { payoutAccountId: 'RCP_test' } });
        const p1 = await request(h.server).post('/admin/payouts/run').set(bearer(admin.token)).send({ runKey: key }).expect(200);
        const p2 = await request(h.server).post('/admin/payouts/run').set(bearer(admin.token)).send({ runKey: key }).expect(200);
        expect(p1.body.paid).toEqual(expect.arrayContaining([expect.objectContaining({ vendorId: o.v.vendor.id, amountKobo: '900000' })]));
        expect(p2.body.paid).toEqual([]);
        expect(await bal()).toMatchObject({ availableKobo: '0', paidOutKobo: '900000' });
      } else {
        expect(after).toMatchObject({ pendingKobo: '0', holdKobo: '0', availableKobo: '0' });
        expect((await h.db.subOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe('REFUNDED');
      }
      expect(await ledgerOk()).toBe(true);
    };
    await run('REJECT');
    await run('REFUND');
    const chk = await request(h.server).get('/admin/ledger/check').set(bearer(admin.token)).expect(200);
    expect(chk.body.ok).toBe(true);
  });

  it('48h vendor SLA: silence => auto refund', async () => {
    const o = await paidOrder(1000000n, 1);
    const { body, signature } = h.pay.buildChargeSuccess({ eventId: `evt-s-${o.orderId}`, reference: o.orderId, amountKobo: o.total });
    await hook(body, signature);
    const so = await h.db.subOrder.findFirstOrThrow({ where: { orderId: o.orderId } });
    await request(h.server).post(`/vendor/orders/${so.id}/ship`).set(bearer(o.v.user.token)).send({ courier: 'DHL', trackingNo: 'TRK2' }).expect(201);
    await request(h.server).post(`/orders/${o.orderId}/events`).set(bearer(o.u.token)).send({ type: 'CONFIRM_DELIVERY' }).expect(201);
    await request(h.server).post(`/orders/${o.orderId}/returns`).set(bearer(o.u.token)).send({ subOrderId: so.id, reason: 'wrong colour' }).expect(201);
    const { ReturnsService } = await import('../src/modules/returns');
    expect(await h.app.get(ReturnsService).slaSweep(new Date(Date.now() + 49 * 3600_000))).toBeGreaterThanOrEqual(1);
    expect((await h.db.subOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe('REFUNDED');
    expect(await ledgerOk()).toBe(true);
  });

  it('state machine guards: ship before payment, double ship, other vendor', async () => {
    const o = await paidOrder();
    const so = await h.db.subOrder.findFirstOrThrow({ where: { orderId: o.orderId } });
    const other = await mkVendor(h.db);
    await request(h.server).post(`/vendor/orders/${so.id}/ship`).set(bearer(o.v.user.token)).send({ courier: 'DHL', trackingNo: 'X123' }).expect(409);
    await request(h.server).post(`/vendor/orders/${so.id}/ship`).set(bearer(other.user.token)).send({ courier: 'DHL', trackingNo: 'X123' }).expect(404);
    await request(h.server).post(`/orders/${o.orderId}/events`).set(bearer(o.u.token)).send({ type: 'CONFIRM_DELIVERY' }).expect(409);
  });
});
