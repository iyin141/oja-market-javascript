// Live end-to-end API flow (no mocks): node tests/e2e/api-flow.mjs   (API on API_URL, seed loaded)
const API = process.env.API_URL || "http://localhost:4100";
const PW = "Passw0rd!demo";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

async function call(method, path, { token, body, headers = {} } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PW } })).j?.accessToken;

const cust = await login("customer@oja.test");
const EMAIL = { "lagos-gadget-hub": "vendor1@oja.test", "ankara-and-co": "vendor2@oja.test", "mama-put-pantry": "vendor3@oja.test" };
const admin = await login("admin@oja.test");

// pick one variant from each of two vendors
const list = (await call("GET", "/products?limit=60")).j;
const byVendor = {};
for (const p of list) (byVendor[p.vendorSlug] ??= []).push(p);
const [slugA, slugB] = Object.keys(byVendor);
const vA = await login(EMAIL[slugA]), vB = await login(EMAIL[slugB]);
ok(cust && vA && vB && admin, "logins (customer, 2 vendors, admin)");
const pa = (await call("GET", `/products/${byVendor[slugA][0].id}`)).j;
const pb = (await call("GET", `/products/${byVendor[slugB][0].id}`)).j;
const va = pa.variants[0], vb = pb.variants[0];
ok(va && vb, `two products from two vendors (${slugA}, ${slugB})`);

const search = await call("GET", "/search?q=power");
ok(search.s === 200, `search q=power -> ${search.s}`);

await call("PUT", "/cart", { token: cust, body: { items: [] } });
const put = await call("PUT", "/cart", { token: cust, body: { items: [{ variantId: va.id, qty: 2 }, { variantId: vb.id, qty: 1 }] } });
ok(put.s === 200, `cart PUT -> ${put.s}`);

const key = "e2e-" + Date.now();
const co1 = await call("POST", "/checkout", { token: cust, headers: { "idempotency-key": key }, body: { paymentMethod: "CARD" } });
ok(co1.s === 200 || co1.s === 201, `checkout -> ${co1.s}`);
const orderId = co1.j?.orderId;

const co2 = await call("POST", "/checkout", { token: cust, headers: { "idempotency-key": key }, body: { paymentMethod: "CARD" } });
ok(co2.j?.orderId === orderId, "idempotent retry returns the same order");
ok((await call("POST", "/checkout", { token: cust, body: {} })).s === 400, "checkout without Idempotency-Key -> 400");

const pay = await call("POST", "/payments/fake/charge", { token: cust, body: { reference: orderId } });
ok(pay.s === 200 && pay.j?.status === "posted", `fake webhook payment -> ${pay.s} ${pay.j?.status}`);
const pay2 = await call("POST", "/payments/fake/charge", { token: cust, body: { reference: orderId } });
ok(pay2.j?.status === "already_paid" || pay2.j?.status === "duplicate", `replayed payment is a no-op (${pay2.j?.status})`);

const order = (await call("GET", `/orders/${orderId}`, { token: cust })).j;
const subs = order?.subOrders ?? order?.subs ?? [];
ok(subs.length === 2 && subs.every((s) => s.status === "PAID"), `2-vendor cart -> 1 order, ${subs.length} sub-orders, all PAID (${subs.map((s) => s.status)})`);

// vendors ship their own sub-orders
for (const [tok, name] of [[vA, slugA], [vB, slugB]]) {
  const mine = (await call("GET", "/vendor/orders", { token: tok })).j;
  const so = (Array.isArray(mine) ? mine : mine?.items ?? []).find((o) => (o.orderId ?? o.order_id) === orderId);
  ok(!!so, `${name} sees the sub-order`);
  if (so) {
    const id = so.id ?? so.subOrderId;
        const sh = await call("POST", `/vendor/orders/${id}/ship`, { token: tok, body: { courier: "DHL", trackingNo: "TRK" + Date.now() } });
    ok(sh.s === 200 || sh.s === 201, `${name} ship -> ship ${sh.s}`);
  }
}
const del = await call("POST", `/orders/${orderId}/events`, { token: cust, body: { type: "CONFIRM_DELIVERY" } });
ok(del.s === 200 || del.s === 201, `customer confirms delivery -> ${del.s}`);

const bal = await call("GET", "/vendor/balance", { token: vA });
ok(bal.s === 200, `vendor balance -> ${bal.s} ${JSON.stringify(bal.j).slice(0, 120)}`);
const led = await call("GET", "/admin/ledger/check", { token: admin });
ok(led.s === 200 && (led.j?.balanced === true || led.j?.ok === true), `admin ledger check -> ${JSON.stringify(led.j).slice(0, 120)}`);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
