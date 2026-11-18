"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api, apiStrict } from "@/lib/api";
import { EMPTY_BALANCE, FIXTURE_BALANCE, FIXTURE_VENDOR_ORDERS, pick } from "@/lib/fixtures";
import { formatKobo } from "@/lib/money";
import { getToken } from "@/lib/session";
import type { Balance, VendorOrderRow } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { FormModal, ModalField } from "./Modal";
import { btn, Column, DataTable, Icon, inputCls, Notice, PageTitle, StatTile, StatusChip } from "./ui";

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
  const bal = useApi<Balance>("/vendor/balance", pick(EMPTY_BALANCE, FIXTURE_BALANCE));
  const orders = useApi<VendorOrderRow[]>("/vendor/orders", pick([], FIXTURE_VENDOR_ORDERS));
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
  const { data, live, reload } = useApi<VendorOrderRow[]>("/vendor/orders", pick([], FIXTURE_VENDOR_ORDERS));
  const [err, setErr] = useState("");
  const [shipFor, setShipFor] = useState<VendorOrderRow | null>(null);
  const [courier, setCourier] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  async function ship() {
    if (!shipFor) return;
    try { await apiStrict(`/vendor/orders/${shipFor.id}/ship`, { method: "POST", token: getToken(), body: JSON.stringify({ courier, trackingNo }) }); setErr(""); setShipFor(null); setCourier(""); setTrackingNo(""); reload(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not ship"); }
  }
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Orders" sub="Each order is your own sub-order; other vendors' items are not shown." />
      <FormModal open={!!shipFor} title="Ship this order" subtitle={shipFor ? `Order ${shipFor.id.slice(0, 8)}` : undefined} submitLabel="Confirm shipment" error={err} onSubmit={() => void ship()} onClose={() => { setShipFor(null); setErr(""); }}>
        <ModalField label="Courier"><input className="modal-input" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="e.g. GIG, DHL" minLength={2} required /></ModalField>
        <ModalField label="Tracking number"><input className="modal-input" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} minLength={3} required /></ModalField>
      </FormModal>
      <DataTable columns={orderCols((r) => ["PAID", "AWAITING_COLLECTION", "PACKED"].includes(r.status) ? <button className={btn.primary} onClick={() => setShipFor(r)}>Ship</button> : null)} rows={data} rowKey={(r) => r.id} empty="No orders yet." />
    </>
  );
}

interface ProdImage { id: string; key: string; status: "PENDING" | "PROCESSING" | "READY" | "REJECTED" }
interface Prod { id: string; title: string; status: string; images?: ProdImage[]; variants: { id: string; sku: string; priceKobo: string; inventory: { onHand: number; reserved: number } | null }[] }
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
  const { data, live, reload } = useApi<Prod[]>("/vendor/products", pick([], FX_PRODUCTS));
  const cats = useApi<{ id: string; name: string }[]>("/categories", []);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [nf, setNf] = useState({ title: "", description: "", categoryId: "", sku: "", naira: "", stock: "1" });
  async function addProduct() {
    setBusy(true); setErr("");
    try {
      const kobo = Math.round(Number(nf.naira) * 100);
      if (!Number.isFinite(kobo) || kobo < 1) throw new Error("Enter a price in naira");
      await apiStrict("/vendor/products", { method: "POST", token: getToken(), body: JSON.stringify({ title: nf.title, description: nf.description, categoryId: nf.categoryId || cats.data[0]?.id, variants: [{ sku: nf.sku, priceKobo: String(kobo), stock: Number(nf.stock) }] }) });
      setAdding(false); setNf({ title: "", description: "", categoryId: "", sku: "", naira: "", stock: "1" }); reload();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not add product"); }
    setBusy(false);
  }
  const patch = async (path: string, body: object, done?: string) => {
    try { await apiStrict(path, { method: "PATCH", token: getToken(), body: JSON.stringify(body) }); setErr(""); setInfo(done ?? ""); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Update failed"); setInfo(""); }
  };
  const rows = data.flatMap((p) => p.variants.map((v) => ({ p, v })));
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Products and inventory" sub="Click a price or stock level to edit it inline." />
      <div className="mb-space-sm"><button type="button" className={btn.primary} onClick={() => { setErr(""); setAdding(true); }}>Add product</button></div>
      <FormModal open={adding} title="Add product" subtitle="Saved as a draft. Submit it for review when ready." submitLabel="Add product" busy={busy} error={err} onSubmit={() => void addProduct()} onClose={() => { setAdding(false); setErr(""); }}>
        <ModalField label="Title"><input className="modal-input" value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} minLength={2} required /></ModalField>
        <ModalField label="Description"><textarea className="modal-input" rows={3} value={nf.description} onChange={(e) => setNf({ ...nf, description: e.target.value })} /></ModalField>
        <ModalField label="Category"><select className="modal-input" value={nf.categoryId || cats.data[0]?.id || ""} onChange={(e) => setNf({ ...nf, categoryId: e.target.value })}>{cats.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></ModalField>
        <ModalField label="SKU"><input className="modal-input" value={nf.sku} onChange={(e) => setNf({ ...nf, sku: e.target.value })} required /></ModalField>
        <ModalField label="Price (naira)"><input className="modal-input" inputMode="decimal" value={nf.naira} onChange={(e) => setNf({ ...nf, naira: e.target.value })} required /></ModalField>
        <ModalField label="Stock"><input className="modal-input" inputMode="numeric" value={nf.stock} onChange={(e) => setNf({ ...nf, stock: e.target.value })} required /></ModalField>
      </FormModal>
      {err && <p role="alert" className="text-status-danger mb-space-sm">{err}</p>}
      {info && <p role="status" className="bg-status-info/10 text-status-info rounded-lg px-space-md py-space-sm mb-space-sm font-label-md text-label-md">{info}</p>}
      <DataTable rowKey={(r) => r.v.id} rows={rows} empty="No products yet." columns={[
        { key: "t", header: "Product", render: ({ p, v }) => <span><span className="font-label-md">{p.title}</span> <span className="text-text-secondary">{v.sku}</span></span> },
        { key: "s", header: "Status", render: ({ p }) => <div className="flex flex-col gap-1 max-w-[16rem]"><StatusChip label={STATUS[p.status]?.[0] ?? p.status} tone={p.status === "ACTIVE" ? "success" : p.status === "REVIEW" ? "warning" : "neutral"} /><span className="font-caption text-caption text-text-secondary">{STATUS[p.status]?.[1]}</span></div> },
        { key: "pr", header: "Price (kobo)", render: ({ v }) => <InlineEdit label="price in kobo" value={v.priceKobo} format={formatKobo} onSave={(x) => patch(`/vendor/variants/${v.id}`, { priceKobo: x })} /> },
        { key: "st", header: "On hand", render: ({ v }) => <InlineEdit label="stock" value={String(v.inventory?.onHand ?? 0)} onSave={(x) => patch(`/vendor/variants/${v.id}`, { stock: Number(x) })} /> },
        { key: "rs", header: "Reserved", render: ({ v }) => v.inventory?.reserved ?? 0 },
        { key: "a", header: "", render: ({ p }) => p.status === "DRAFT" ? <button className={btn.ghost} onClick={() => patch(`/vendor/products/${p.id}`, { status: "REVIEW" }, `"${p.title}" is now in review. It stays hidden from shoppers until an admin approves it; its status here changes to Live once approved.`)}>Submit for review</button> : null },
      ]} />
      <h2 className="font-title-sm text-title-sm mt-space-lg mb-space-sm">Product pictures</h2>
      {data.length === 0 ? <p className="text-text-secondary">Add a product first.</p> : (
        <div className="flex flex-col gap-space-sm">{data.map((p) => <ProductImages key={p.id} p={p} onChange={reload} />)}</div>
      )}
    </>
  );
}

const STATUS: Record<string, [string, string]> = {
  DRAFT: ["Draft", "Not visible to shoppers. Submit it for review when it is ready."],
  REVIEW: ["In review", "Waiting for an admin. It goes live once approved, or comes back here as a draft if rejected."],
  ACTIVE: ["Live", "Visible in the shop."],
  ARCHIVED: ["Archived", "Hidden."],
};
const MEDIA = process.env.NEXT_PUBLIC_MEDIA_BASE_URL; // public image bucket URL, e.g. https://files.example.com/oja-public (no trailing slash)
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMG = 5 * 1024 * 1024;

/** PUT with progress: fetch cannot report upload progress, XMLHttpRequest can. Sends exactly the headers the presigned URL was signed with. */
function putFile(url: string, headers: Record<string, string>, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((100 * e.loaded) / e.total)); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Upload failed (${x.status})`)));
    x.onerror = () => reject(new Error("Upload failed: could not reach the file storage"));
    x.send(file);
  });
}

/** Image upload: presign -> browser PUT straight to object storage -> confirm (the server checks the real bytes and resizes). */
function ProductImages({ p, onChange }: { p: Prod; onChange: () => void }) {
  const [pct, setPct] = useState<number | null>(null);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  async function upload(file: File) {
    setErr("");
    if (!IMG_TYPES.includes(file.type)) { setErr("Use a JPEG, PNG or WebP picture."); return; }
    if (file.size > MAX_IMG) { setErr("That picture is over 5 MB. Choose a smaller one."); return; }
    const token = getToken();
    try {
      setStep("Preparing upload..."); setPct(0);
      const pre = await apiStrict<{ imageId: string; uploadUrl: string; headers: Record<string, string> }>(`/vendor/products/${p.id}/images/presign`, { method: "POST", token, body: JSON.stringify({ contentType: file.type, size: file.size, filename: file.name.slice(0, 200) }) });
      setStep("Uploading...");
      await putFile(pre.uploadUrl, pre.headers, file, setPct);
      setStep("Checking the picture...");
      await apiStrict(`/vendor/products/${p.id}/images/${pre.imageId}/confirm`, { method: "POST", token });
      setPreviews((m) => ({ ...m, [pre.imageId]: URL.createObjectURL(file) }));
      setStep("Uploaded. It is being resized and will appear shortly.");
      onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); setStep(""); }
    setPct(null);
  }
  const imgs = (p.images ?? []).filter((i) => i.status !== "PENDING" || previews[i.id]);
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <span className="font-label-md text-label-md">{p.title}</span>
        <label className={`${btn.ghost} cursor-pointer`}>{pct === null ? "Add picture" : `Uploading ${pct}%`}
          <input type="file" accept={IMG_TYPES.join(",")} className="sr-only" disabled={pct !== null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} /></label>
      </div>
      {pct !== null && <progress className="w-full" max={100} value={pct} aria-label="Upload progress" />}
      {step && <p role="status" className="font-caption text-caption text-text-secondary">{step}</p>}
      {err && <p role="alert" className="text-status-danger font-label-md">{err}</p>}
      <div className="flex flex-wrap gap-space-sm">
        {imgs.length === 0 && <span className="font-caption text-caption text-text-secondary">No pictures yet. JPEG, PNG or WebP, up to 5 MB.</span>}
        {imgs.map((i) => {
          const src = previews[i.id] ?? (MEDIA && i.status === "READY" ? `${MEDIA}/${i.key.replace("raw/", "products/")}-320.webp` : null);
          return (
            <figure key={i.id} className="w-20 flex flex-col items-center gap-1">
              <div className="w-20 h-20 rounded-lg bg-surface-container-low overflow-hidden flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <Icon name={i.status === "REJECTED" ? "broken_image" : "image"} className="text-[28px] text-text-secondary" />}
              </div>
              <figcaption className={`font-caption text-caption ${i.status === "REJECTED" ? "text-status-danger" : "text-text-secondary"}`}>{i.status === "READY" ? "Ready" : i.status === "REJECTED" ? "Rejected" : "Processing"}</figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

interface VendorMe { payoutAccountId: string | null }
interface Bank { name: string; code: string }

/** Bank account for payouts: pick the bank, enter the 10-digit number; the API checks the account name with the bank (Paystack) before saving. */
function BankDetails() {
  const me = useApi<VendorMe | null>("/vendors/me", null);
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [banksErr, setBanksErr] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [acct, setAcct] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");
  const [editing, setEditing] = useState(false);
  const has = !!me.data?.payoutAccountId;
  const showForm = !me.loading && (!has || editing);
  useEffect(() => {
    if (!showForm || banks) return; // load the bank list only when the form is shown
    let alive = true;
    api<Bank[]>("/vendors/banks", [], { token: getToken() }).then((r) => {
      if (!alive) return;
      if (r.live) setBanks(r.data);
      else setBanksErr(r.status === 409 ? "Bank payouts are not enabled on this marketplace yet." : "Could not load the list of banks. Try again shortly.");
    });
    return () => { alive = false; };
  }, [showForm, banks]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(""); setSaved("");
    if (!/^d{10}$/.test(acct)) { setErr("An account number has 10 digits."); return; }
    setBusy(true);
    try {
      const r = await apiStrict<{ accountName: string }>("/vendors/me/paystack/recipient", { method: "POST", token: getToken(), body: JSON.stringify({ bankCode, accountNumber: acct }) });
      setSaved(`Payout account saved: ${r.accountName}.`); setAcct(""); setEditing(false); me.reload();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not save the account"); }
    setBusy(false);
  }
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md mb-space-lg">
      <h2 className="font-title-sm text-title-sm mb-space-xs">Payout bank account</h2>
      {me.loading ? <p className="text-text-secondary">Loading...</p> : (
        <p className={`font-label-md text-label-md mb-space-sm ${has ? "text-status-success" : "text-status-warning"}`}>
          {has ? "A bank account is connected. Payouts are sent to it." : "No bank account yet. Add one to be paid out; until then payouts are only recorded in the ledger."}
        </p>
      )}
      {saved && <p role="status" className="text-status-success font-label-md mb-space-sm">{saved}</p>}
      {has && !editing && <button className={btn.ghost} onClick={() => setEditing(true)}>Change account</button>}
      {showForm && (banksErr ? <p role="alert" className="text-status-danger font-label-md">{banksErr}</p> : (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-space-sm">
          <label className="flex flex-col gap-1 font-label-sm text-label-sm">Bank
            <select className={inputCls} value={bankCode} onChange={(e) => setBankCode(e.target.value)} required disabled={!banks}>
              <option value="">{banks ? "Choose your bank" : "Loading banks..."}</option>
              {(banks ?? []).map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select></label>
          <label className="flex flex-col gap-1 font-label-sm text-label-sm">Account number
            <input className={inputCls} inputMode="numeric" maxLength={10} pattern="[0-9]{10}" value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ""))} required /></label>
          <button className={btn.primary} disabled={busy || !bankCode}>{busy ? "Verifying..." : "Save account"}</button>
          {has && <button type="button" className={btn.ghost} onClick={() => setEditing(false)}>Cancel</button>}
          {err && <p role="alert" className="basis-full text-status-danger font-label-md">{err}</p>}
        </form>
      ))}
    </section>
  );
}

export function SellerPayouts() {
  const bal = useApi<Balance>("/vendor/balance", pick(EMPTY_BALANCE, FIXTURE_BALANCE));
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
      <BankDetails />
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
