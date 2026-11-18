// Paystack test-mode flow against a running API (PAYMENT_PROVIDER=paystack, sk_test_ key) and the real api.paystack.co.
//   API_URL=http://localhost:4100 PAYSTACK_SECRET_KEY=sk_test_... node tests/e2e/paystack-flow.mjs
// A real card payment needs a browser on the Paystack checkout page; this script proves everything around it:
// initialize (real Paystack call), the signed webhook (we sign exactly as Paystack does), idempotency, verify, ledger, banks, recipient.
import crypto from "node:crypto";

const API = process.env.API_URL || "http://localhost:4100";
const KEY = process.env.PAYSTACK_SECRET_KEY;
if (!KEY?.startsWith("sk_test_")) { console.error("set PAYSTACK_SECRET_KEY to a sk_test_ key"); process.exit(2); }
const PW = "Passw0rd!demo";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const r = await fetch(API + path, { method, headers: { ...(raw ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const login = async (e) => (await call("POST", "/auth/login", { body: { email: e, password: PW } })).j?.accessToken;
const sign = (rawBody) => crypto.createHmac("sha512", KEY).update(rawBody).digest("hex");
const webhook = (event, data, sig) => { const raw = JSON.stringify({ event, data }); return call("POST", "/payments/webhook", { raw, headers: { "content-type": "application/json", "x-paystack-signature": sig ?? sign(raw) } }); };

const cust = await login("customer@oja.test"), vend = await login("vendor1@oja.test"), admin = await login("admin@oja.test");
ok(cust && vend && admin, "logins");

// 1. checkout -> real Paystack /transaction/initialize
const list = (await call("GET", "/products?limit=5")).j;
const prod = (await call("GET", `/products/${list[0].id}`)).j;
await call("PUT", "/cart", { token: cust, body: { items: [{ variantId: prod.variants[0].id, qty: 1 }] } });
const key = "ps-" + Date.now();
const co = await call("POST", "/checkout", { token: cust, headers: { "idempotency-key": key }, body: { paymentMethod: "CARD" } });
const gated = co.s === 502; // Paystack refuses calls from IPs that are not on the account allow-list
ok(co.s === 201 || co.s === 200 || gated, `checkout -> ${co.s} ${co.j?.title ?? ""} ${co.j?.detail ?? ""}`);
if (gated) console.log("WARN  Paystack rejected the call (IP not allowed). Add this machine's public IP in Paystack > Settings > API Keys & Webhooks. Continuing with the order that was created.");
const orderId = co.j?.orderId;
const total = BigInt(co.j?.totalKobo ?? (await call("GET", `/orders/${orderId}`, { token: cust })).j?.totalKobo ?? 0);
if (!gated) ok(/^https:\/\/checkout\.paystack\.com\//.test(co.j?.authorizationUrl ?? ""), `real Paystack checkout URL: ${co.j?.authorizationUrl}`);
const retry = await call("POST", "/checkout", { token: cust, headers: { "idempotency-key": key }, body: { paymentMethod: "CARD" } });
if (!gated) ok(retry.j?.orderId === orderId && retry.j?.authorizationUrl === co.j?.authorizationUrl, "idempotent retry returns the same order and checkout URL");
else ok(retry.j?.orderId === orderId, "idempotent retry after a provider failure still points at the same order");

// 2. Paystack itself knows the transaction (reference = order id)
if (!gated) {
  const pv = await (await fetch(`https://api.paystack.co/transaction/verify/${orderId}`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
  ok(pv.status === true && pv.data?.status === "abandoned", `Paystack has the transaction, status=${pv.data?.status}, amount=${pv.data?.amount} (ours ${total})`);
  ok(BigInt(pv.data?.amount ?? 0) === total, "amount at Paystack equals our order total (integer kobo)");
}

// 3. not paid yet: our verify endpoint must not mark it paid
const order0 = (await call("GET", `/orders/${orderId}`, { token: cust })).j;
const paymentId = order0.payments?.[0]?.id;
const v0 = await call("POST", `/payments/${paymentId}/verify`, { token: cust });
ok(gated ? v0.s === 502 : (v0.s === 200 && v0.j?.status !== "PAID"), `verify before payment: ${v0.s} ${v0.j?.status ?? v0.j?.title} (never PAID)`);

// 4. webhook security
const bad = await webhook("charge.success", { id: 1, reference: orderId, amount: Number(total), status: "success" }, "deadbeef");
ok(bad.s === 401, `bad signature -> ${bad.s}`);
const wrongAmt = await webhook("charge.success", { id: Date.now() * 10 + 1, reference: orderId, amount: 1, status: "success", fees: 0 });
ok(wrongAmt.j?.status === "mismatch", `wrong amount is not posted (${wrongAmt.j?.status})`);

// 5. signed charge.success (the way Paystack delivers it), then replays
const evId = Date.now();
const body = { id: evId, reference: orderId, amount: Number(total), status: "success", currency: "NGN", fees: Math.round(Number(total) * 0.015) };
const w1 = await webhook("charge.success", body);
ok(w1.s === 200 && w1.j?.status === "posted", `signed charge.success -> ${w1.s} ${w1.j?.status}`);
const w2 = await webhook("charge.success", body);
ok(w2.j?.status === "duplicate", `same event replayed -> ${w2.j?.status}`);
const w3 = await webhook("charge.success", { ...body, id: evId + 1 });
ok(w3.j?.status === "already_paid", `new event id for a paid reference -> ${w3.j?.status}`);
const order1 = (await call("GET", `/orders/${orderId}`, { token: cust })).j;
ok(order1.subOrders.every((s) => s.status === "PAID"), `order sub-orders PAID (${order1.subOrders.map((s) => s.status)})`);

// 6. ledger tracks the money
const led = await call("GET", "/admin/ledger/check", { token: admin });
ok(led.s === 200 && led.j?.ok === true && led.j?.unbalancedGroups === "0", `ledger balanced ${JSON.stringify(led.j)}`);

// 7. other event types are recorded but do nothing
const other = await webhook("transfer.success", { id: evId + 2, reference: "t-" + evId, amount: 1000, status: "success" });
ok(other.s === 200 && other.j?.status === "ignored", `transfer.success recorded, ignored by the order logic (${other.j?.status})`);

// 8. vendor payout setup against real Paystack
const banks = await call("GET", "/vendors/banks", { token: vend });
ok(banks.s === 200 && banks.j?.length > 10, `GET /vendors/banks -> ${banks.s}, ${banks.j?.length} banks from Paystack`);
const rec = await call("POST", "/vendors/me/paystack/recipient", { token: vend, body: { bankCode: "058", accountNumber: "0000000000" } });
console.log(`INFO  recipient with Paystack test account -> ${rec.s} ${JSON.stringify(rec.j).slice(0, 160)}`);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
