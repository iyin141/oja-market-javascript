"use client";
import { useState } from "react";
import { apiStrict } from "@/lib/api";
import { FIXTURE_BALANCE, FIXTURE_VENDOR_ORDERS } from "@/lib/fixtures";
import { formatKobo } from "@/lib/money";
import { getToken } from "@/lib/session";
import type { Balance, VendorOrderRow } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { btn, Column, DataTable, inputCls, Notice, PageTitle, StatTile, StatusChip } from "./ui";

const orderCols = (act?: (r: VendorOrderRow) => React.ReactNode): Column<VendorOrderRow>[] => [
  { key: "id", header: "Order", render: (r) => <span className="font-label-md">{r.id.slice(0, 8)}</span> },
  { key: "items", header: "Items", render: (r) => r.items.map((i) => `${i.qty} x ${i.title}`).join(", ") },
  { key: "buyer", header: "Customer", render: (r) => r.order.user.name },
  { key: "pay", header: "Payment", render: (r) => r.order.paymentMethod === "COD" ? "Pay on delivery" : "Card" },
  { key: "total", header: "Subtotal", render: (r) => formatKobo(r.subtotalKobo), className: "text-right" },
  { key: "st", header: "Status", render: (r) => <StatusChip status={r.status} /> },
  ...(act ? [{ key: "act", header: "", render: act }] : []),
];

export function SellerDashboard() {
  const bal = useApi<Balance>("/vendor/balance", FIXTURE_BALANCE);
  const orders = useApi<VendorOrderRow[]>("/vendor/orders", FIXTURE_VENDOR_ORDERS);
  const open = orders.data.filter((o) => ["PAID", "AWAITING_COLLECTION", "PACKED"].includes(o.status)).length;
  return (
    <>
      <Notice live={bal.live && orders.live} />
      <PageTitle title="Seller dashboard" sub="Balances come straight from the ledger." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md mb-space-lg">
        <StatTile label="Pending (hold period)" value={formatKobo(bal.data.pendingKobo)} icon="hourglass_top" />
        <StatTile label="Available for payout" value={formatKobo(bal.data.availableKobo)} icon="account_balance_wallet" />
        <StatTile label="On hold (disputes)" value={formatKobo(bal.data.holdKobo)} icon="gavel" />
        <StatTile label="Orders to ship" value={open} icon="local_shipping" />
      </div>
      <h2 className="font-title-sm text-title-sm mb-space-sm">Recent orders</h2>
      <DataTable columns={orderCols()} rows={orders.data.slice(0, 5)} rowKey={(r) => r.id} />
    </>
  );
}

export function SellerOrders() {
  const { data, live, reload } = useApi<VendorOrderRow[]>("/vendor/orders", FIXTURE_VENDOR_ORDERS);
  const [err, setErr] = useState("");
  async function ship(r: VendorOrderRow) {
    const courier = window.prompt("Courier name (e.g. GIG, DHL)"); if (!courier) return;
    const trackingNo = window.prompt("Tracking number"); if (!trackingNo) return;
    try { await apiStrict(`/vendor/orders/${r.id}/ship`, { method: "POST", token: getToken(), body: JSON.stringify({ courier, trackingNo }) }); setErr(""); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not ship"); }
  }
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Orders" sub="Each order is your own sub-order; other vendors' items are not shown." />
      {err && <p role="alert" className="text-status-danger mb-space-sm">{err}</p>}
      <DataTable columns={orderCols((r) => ["PAID", "AWAITING_COLLECTION", "PACKED"].includes(r.status) ? <button className={btn.primary} onClick={() => ship(r)}>Ship</button> : null)} rows={data} rowKey={(r) => r.id} empty="No orders yet." />
    </>
  );
}

interface Prod { id: string; title: string; status: string; variants: { id: string; sku: string; priceKobo: string; inventory: { onHand: number; reserved: number } | null }[] }
const FX_PRODUCTS: Prod[] = [{ id: "p1", title: "Apex Audio Pro Headphones", status: "ACTIVE", variants: [{ id: "v1", sku: "BLK", priceKobo: "8500000", inventory: { onHand: 14, reserved: 2 } }] },
  { id: "p2", title: "Wireless Earbuds", status: "DRAFT", variants: [{ id: "v2", sku: "EB-1", priceKobo: "3200000", inventory: { onHand: 3, reserved: 0 } }] }];

function InlineEdit({ value, onSave, label, format }: { value: string; onSave: (v: string) => Promise<void>; label: string; format?: (v: string) => string }) {
  const [editing, setEditing] = useState(false); const [v, setV] = useState(value);
  if (!editing) return <button type="button" className="underline decoration-dotted" onClick={() => { setV(value); setEditing(true); }} aria-label={`Edit ${label}`}>{format ? format(value) : value}</button>;
  return (
    <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); await onSave(v); setEditing(false); }}>
      <input className={`${inputCls} w-28`} value={v} onChange={(e) => setV(e.target.value)} aria-label={label} inputMode="numeric" autoFocus />
      <button className={btn.primary}>Save</button>
    </form>
  );
}

export function SellerProducts() {
  const { data, live, reload } = useApi<Prod[]>("/vendor/products", FX_PRODUCTS);
  const [err, setErr] = useState("");
  const patch = async (path: string, body: object) => {
    try { await apiStrict(path, { method: "PATCH", token: getToken(), body: JSON.stringify(body) }); setErr(""); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Update failed"); }
  };
  const rows = data.flatMap((p) => p.variants.map((v) => ({ p, v })));
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Products and inventory" sub="Click a price or stock level to edit it inline." />
      {err && <p role="alert" className="text-status-danger mb-space-sm">{err}</p>}
      <DataTable rowKey={(r) => r.v.id} rows={rows} empty="No products yet." columns={[
        { key: "t", header: "Product", render: ({ p, v }) => <span><span className="font-label-md">{p.title}</span> <span className="text-text-secondary">{v.sku}</span></span> },
        { key: "s", header: "Status", render: ({ p }) => <StatusChip label={p.status} tone={p.status === "ACTIVE" ? "success" : p.status === "REVIEW" ? "warning" : "neutral"} /> },
        { key: "pr", header: "Price (kobo)", render: ({ v }) => <InlineEdit label="price in kobo" value={v.priceKobo} format={formatKobo} onSave={(x) => patch(`/vendor/variants/${v.id}`, { priceKobo: x })} /> },
        { key: "st", header: "On hand", render: ({ v }) => <InlineEdit label="stock" value={String(v.inventory?.onHand ?? 0)} onSave={(x) => patch(`/vendor/variants/${v.id}`, { stock: Number(x) })} /> },
        { key: "rs", header: "Reserved", render: ({ v }) => v.inventory?.reserved ?? 0 },
        { key: "a", header: "", render: ({ p }) => p.status === "DRAFT" ? <button className={btn.ghost} onClick={() => patch(`/vendor/products/${p.id}`, { status: "REVIEW" })}>Submit for review</button> : null },
      ]} />
    </>
  );
}

export function SellerPayouts() {
  const bal = useApi<Balance>("/vendor/balance", FIXTURE_BALANCE);
  const tx = useApi<{ id: string; account: string; direction: string; amountKobo: string; ref: string; createdAt: string }[]>("/vendor/transactions", []);
  return (
    <>
      <Notice live={bal.live} />
      <PageTitle title="Payouts" sub="Money moves pending, then available after the hold period, then paid out." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md mb-space-lg">
        <StatTile label="Pending" value={formatKobo(bal.data.pendingKobo)} />
        <StatTile label="Available" value={formatKobo(bal.data.availableKobo)} />
        <StatTile label="On hold" value={formatKobo(bal.data.holdKobo)} />
        <StatTile label="Paid out" value={formatKobo(bal.data.paidOutKobo)} />
      </div>
      <h2 className="font-title-sm text-title-sm mb-space-sm">Ledger activity</h2>
      <DataTable rowKey={(r) => r.id} rows={tx.data} empty="No ledger activity yet." columns={[
        { key: "d", header: "Date", render: (r) => new Date(r.createdAt).toLocaleString() },
        { key: "a", header: "Account", render: (r) => r.account.replace("vendor_payable_", "") },
        { key: "r", header: "Reference", render: (r) => r.ref },
        { key: "m", header: "Amount", className: "text-right", render: (r) => `${r.direction === "CREDIT" ? "+" : "-"}${formatKobo(r.amountKobo)}` },
      ]} />
    </>
  );
}

/** KYC: presign -> browser PUT straight to object storage -> confirm. */
export function Onboarding() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "uploading" | "done">("idle");
  const [err, setErr] = useState("");
  async function submit() {
    if (!file) return;
    setState("uploading"); setErr("");
    try {
      const token = getToken();
      const p = await apiStrict<{ key: string; uploadUrl: string; headers: Record<string, string> }>("/vendors/me/kyc", { method: "PATCH", token, body: JSON.stringify({ contentType: file.type, size: file.size }) });
      const put = await fetch(p.uploadUrl, { method: "PUT", headers: p.headers, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await apiStrict("/vendors/me/kyc", { method: "PATCH", token, body: JSON.stringify({ docKey: p.key }) });
      setState("done");
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); setState("idle"); }
  }
  return (
    <>
      <PageTitle title="Verify your business" sub="Upload a government-issued ID or CAC certificate (PDF, JPEG or PNG, max 10 MB). An admin reviews it before your store goes live." />
      <div className="bg-surface-card rounded-xl p-space-lg shadow-sm max-w-xl flex flex-col gap-space-md">
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Document
          <input type="file" accept="application/pdf,image/jpeg,image/png" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        {err && <p role="alert" className="text-status-danger">{err}</p>}
        {state === "done" ? <p role="status" className="text-status-success font-label-md">Submitted. We will email you when your store is approved.</p>
          : <button className={btn.primary} disabled={!file || state === "uploading"} onClick={submit}>{state === "uploading" ? "Uploading..." : "Submit for review"}</button>}
      </div>
    </>
  );
}
