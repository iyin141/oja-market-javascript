"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { apiStrict } from "@/lib/api";
import { EMPTY_KPIS, FIXTURE_KPIS, pick } from "@/lib/fixtures";
import { formatKobo } from "@/lib/money";
import { getToken } from "@/lib/session";
import type { Kpis } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { SeriesChart, type Series } from "./Chart";
import { ConfirmDialog } from "./interactive";
import { FormModal, ModalField } from "./Modal";
import { btn, Column, DataTable, Icon, Notice, PageTitle, StatTile, StatusChip } from "./ui";

export function AdminDashboard() {
  const { data: k, live } = useApi<Kpis>("/admin/kpis", pick(EMPTY_KPIS, FIXTURE_KPIS));
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Platform overview" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md mb-space-md">
        <StatTile label="GMV" value={formatKobo(k.gmvKobo)} icon="payments" hint={`${k.paidSubOrders} paid sub-orders`} />
        <StatTile label="Commission earned" value={formatKobo(k.commissionKobo)} icon="percent" />
        <StatTile label="Refunded" value={formatKobo(k.refundedKobo)} icon="undo" />
        <StatTile label="Open disputes" value={k.openDisputes} icon="gavel" />
        <StatTile label="Vendor applications" value={k.pendingVendors} icon="how_to_reg" />
        <Link href="/admin/products" aria-label="Review products" className="rounded-xl focus:outline-2 focus:outline-secondary"><StatTile label="Products in review" value={k.pendingProducts} icon="fact_check" hint="Open the review queue" /></Link>
        <StatTile label="Flagged vendors" value={k.flaggedVendors} icon="flag" />
        <StatTile label="Ledger check" value={<span className={k.ledger.ok ? "text-status-success" : "text-status-danger"}>{k.ledger.ok ? "Balanced" : "MISMATCH"}</span>} icon="balance"
          hint={`Dr ${formatKobo(k.ledger.totalDebits)} / Cr ${formatKobo(k.ledger.totalCredits)}`} />
      </div>
      <RunPayouts />
    </>
  );
}

interface PayoutRun { paid: { vendorId: string; storeName: string; amountKobo: string }[]; skipped: { vendorId: string; storeName: string; reason: string }[] }

/** Admin payout run (contract C5). Moves real money, so it asks first and then shows who was paid and who was skipped. */
function RunPayouts() {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<PayoutRun | null>(null);
  async function run() {
    setBusy(true); setErr("");
    try { setResult(await apiStrict<PayoutRun>("/admin/payouts/run", { method: "POST", token: getToken(), body: JSON.stringify({}) })); setAsk(false); }
    catch (e) { setErr(e instanceof Error ? e.message : "Payout run failed"); }
    setBusy(false);
  }
  return (
    <section className="bg-surface-card rounded-xl p-space-md shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div><h2 className="font-title-sm text-title-sm">Vendor payouts</h2><p className="font-body-sm text-body-sm text-text-secondary">Pays every vendor their available balance to the bank account they registered. Running it twice on the same day pays nobody twice.</p></div>
        <button className={btn.primary} onClick={() => { setErr(""); setAsk(true); }}>Run payouts</button>
      </div>
      {result && (
        <div role="status" className="mt-space-md flex flex-col gap-space-xs font-body-sm text-body-sm">
          <p className="font-label-md text-label-md">Paid {result.paid.length} vendor{result.paid.length === 1 ? "" : "s"}, skipped {result.skipped.length}.</p>
          {result.paid.map((p) => <p key={p.vendorId} className="text-status-success">{p.storeName}: {formatKobo(p.amountKobo)}</p>)}
          {result.skipped.map((s) => <p key={s.vendorId} className="text-text-secondary">{s.storeName}: skipped, {s.reason}</p>)}
        </div>
      )}
      <ConfirmDialog open={ask} danger title="Run payouts now?" confirmLabel={busy ? "Running..." : "Run payouts"} onCancel={() => !busy && setAsk(false)} onConfirm={() => void run()}
        body={<>This sends real money to vendor bank accounts and cannot be undone.{err && <span role="alert" className="block text-status-danger mt-2">{err}</span>}</>} />
    </section>
  );
}

interface VendorRow { id: string; storeName: string; status: string; flagged: boolean; score: number; user: { email: string } }
const FX_VENDORS: VendorRow[] = [{ id: "v1", storeName: "Zeta Gadgets", status: "KYC_SUBMITTED", flagged: false, score: 100, user: { email: "zeta@example.com" } }];

export function AdminVendors() {
  const { data, live, reload } = useApi<VendorRow[]>("/admin/vendors", pick([], FX_VENDORS));
  const [target, setTarget] = useState<{ v: VendorRow; to: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState("");
  const [err, setErr] = useState("");
  async function decide() {
    if (!target) return;
    const reason = note.trim();
    if (target.to === "reject" && reason.length < 3) { setNoteErr("Tell the vendor why (at least 3 characters)."); return; }
    try { await apiStrict(`/admin/vendors/${target.v.id}/${target.to}`, { method: "POST", token: getToken(), body: JSON.stringify(target.to === "reject" ? { note: reason } : {}) }); setErr(""); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setTarget(null); setNote(""); setNoteErr("");
  }
  async function viewKyc(v: VendorRow) {
    try { const r = await apiStrict<{ url: string }>(`/admin/vendors/${v.id}/kyc-url`, { token: getToken() }); window.open(r.url, "_blank", "noopener"); }
    catch (e) { setErr(e instanceof Error ? e.message : "No document"); }
  }
  const cols: Column<VendorRow>[] = [
    { key: "n", header: "Store", render: (v) => <span className="font-label-md">{v.storeName}</span> },
    { key: "e", header: "Owner", render: (v) => v.user.email },
    { key: "s", header: "Status", render: (v) => <StatusChip label={v.status.replace(/_/g, " ")} tone={v.status === "APPROVED" ? "success" : v.status === "KYC_SUBMITTED" ? "warning" : "neutral"} /> },
    { key: "sc", header: "Score", render: (v) => <span>{v.score}{v.flagged && <Icon name="flag" className="text-[16px] text-status-danger ml-1" />}</span> },
    { key: "a", header: "", render: (v) => (
      <div className="flex gap-space-xs">
        <button className={btn.ghost} onClick={() => viewKyc(v)}>KYC</button>
        {v.status === "KYC_SUBMITTED" && <><button className={btn.primary} onClick={() => setTarget({ v, to: "approve" })}>Approve</button><button className={btn.ghost} onClick={() => setTarget({ v, to: "reject" })}>Reject</button></>}
      </div>) },
  ];
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Vendors" sub="Approve or reject KYC submissions. Every decision is written to the audit log." />
      {err && <p role="alert" className="text-status-danger mb-space-sm">{err}</p>}
      <DataTable columns={cols} rows={data} rowKey={(v) => v.id} empty="No vendors." />
      <ConfirmDialog open={target?.to === "approve"} title={`Approve ${target?.v.storeName}?`} body="The vendor can start listing products immediately." confirmLabel="Approve"
        onCancel={() => setTarget(null)} onConfirm={decide} />
      <FormModal open={target?.to === "reject"} title={`Reject ${target?.v.storeName}?`} subtitle="The vendor sees this reason and can resubmit." submitLabel="Reject vendor" error={noteErr}
        onSubmit={() => void decide()} onClose={() => { setTarget(null); setNote(""); setNoteErr(""); }}>
        <ModalField label="Reason" hint="Up to 500 characters."><textarea className="modal-input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required /></ModalField>
      </FormModal>
    </>
  );
}

interface Dispute { id: string; reason: string; vendorResponse: string | null; subOrder: { subtotalKobo: string; vendor: { storeName: string } } }
const FX_DISPUTES: Dispute[] = [{ id: "d1", reason: "Arrived damaged", vendorResponse: "Item was fine", subOrder: { subtotalKobo: "8500000", vendor: { storeName: "Lagos Gadget Hub" } } }];

export function AdminDisputes() {
  const { data, live, reload } = useApi<Dispute[]>("/admin/disputes", pick([], FX_DISPUTES));
  const [err, setErr] = useState("");
  async function decide(id: string, decision: "REFUND" | "REJECT") {
    try { await apiStrict(`/admin/disputes/${id}/decide`, { method: "POST", token: getToken(), body: JSON.stringify({ decision }) }); setErr(""); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  }
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Disputes" sub="Deciding moves the vendor's frozen balance: refund reverses it, rejection releases it back to pending." />
      {err && <p role="alert" className="text-status-danger mb-space-sm">{err}</p>}
      <DataTable rowKey={(d) => d.id} rows={data} empty="No open disputes." columns={[
        { key: "v", header: "Vendor", render: (d) => d.subOrder.vendor.storeName },
        { key: "r", header: "Customer reason", render: (d) => d.reason },
        { key: "x", header: "Vendor response", render: (d) => d.vendorResponse ?? "-" },
        { key: "a", header: "Amount", render: (d) => formatKobo(d.subOrder.subtotalKobo), className: "text-right" },
        { key: "b", header: "", render: (d) => <div className="flex gap-space-xs"><button className={btn.primary} onClick={() => decide(d.id, "REFUND")}>Refund customer</button><button className={btn.ghost} onClick={() => decide(d.id, "REJECT")}>Side with vendor</button></div> },
      ]} />
    </>
  );
}

interface Analytics {
  days: number;
  daily: { day: string; gmv_kobo: string; orders: number }[];
  topVendors: { name: string; gmv_kobo: string; commission_kobo: string; orders: number }[];
  topProducts: { title: string; units: number; revenue_kobo: string }[];
  coupons: { discount_kobo: string; orders_with_coupon: number };
}
const FX_ANALYTICS: Analytics = { days: 14, daily: [], topVendors: [], topProducts: [], coupons: { discount_kobo: "0", orders_with_coupon: 0 } };

/** Admin analytics page: GMV and order volume over time (Chart.js) plus vendor and product leaderboards. */
export function AdminAnalytics() {
  const [days, setDays] = useState(14);
  const { data: a, live } = useApi<Analytics>(`/admin/analytics?days=${days}`, FX_ANALYTICS);
  const labels = useMemo(() => a.daily.map((d) => d.day.slice(5)), [a.daily]);
  const series = useMemo<Series[]>(() => [
    { label: "GMV (NGN)", data: a.daily.map((d) => Number(BigInt(d.gmv_kobo) / 100n)), color: "#2f6fed" },
    { label: "Orders", data: a.daily.map((d) => d.orders), color: "#e8710a", type: "line", yAxis: "y1" },
  ], [a.daily]);
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Analytics" actions={
        <select aria-label="Period" className="border border-border-muted rounded-lg px-space-sm py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 14, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>} />
      <div className="bg-surface-card rounded-xl p-space-md shadow-sm mb-space-md">
        <SeriesChart labels={labels} series={series} ariaLabel="GMV and orders per day" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
        <div className="bg-surface-card rounded-xl p-space-md shadow-sm">
          <h2 className="font-title-sm text-title-sm mb-space-sm">Top vendors</h2>
          {a.topVendors.map((v) => <div key={v.name} className="flex justify-between py-1 font-body-sm"><span>{v.name}</span><span>{formatKobo(v.gmv_kobo)} · {v.orders} orders</span></div>)}
        </div>
        <div className="bg-surface-card rounded-xl p-space-md shadow-sm">
          <h2 className="font-title-sm text-title-sm mb-space-sm">Top products</h2>
          {a.topProducts.map((p) => <div key={p.title} className="flex justify-between py-1 font-body-sm"><span>{p.title}</span><span>{formatKobo(p.revenue_kobo)} · {p.units} sold</span></div>)}
        </div>
      </div>
      <p className="mt-space-md font-body-sm text-text-secondary">Coupons: {a.coupons.orders_with_coupon} orders used a coupon, {formatKobo(a.coupons.discount_kobo)} in discounts.</p>
    </>
  );
}

interface ReviewProduct { id: string; title: string; description: string; status: string; vendor: { storeName: string } }

/** Products submitted for review (GET /admin/products defaults to status REVIEW). Approve makes them public; reject sends them back to draft. */
export function AdminProducts() {
  const { data, live, loading, reload } = useApi<ReviewProduct[]>("/admin/products?status=REVIEW", []);
  const [target, setTarget] = useState<{ p: ReviewProduct; to: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const close = () => { setTarget(null); setReason(""); };
  async function decide() {
    if (!target) return;
    const { p, to } = target;
    try {
      await apiStrict(`/admin/products/${p.id}/${to}`, { method: "POST", token: getToken(), body: JSON.stringify(to === "reject" ? { note: reason.trim() } : {}) });
      setErr(""); setOk(`${p.title} ${to === "approve" ? "is now live" : "was sent back to the vendor as a draft"}.`); reload();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setOk(""); }
    close();
  }
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Product review" sub="Products vendors submitted. Approving publishes them in the shop; rejecting returns them to the vendor as a draft." />
      {err && <p role="alert" className="text-status-danger mb-space-sm">{err}</p>}
      {ok && <p role="status" className="text-status-success mb-space-sm">{ok}</p>}
      {loading ? <p role="status" className="text-text-secondary">Loading...</p> : (
        <DataTable rowKey={(p) => p.id} rows={data} empty="Nothing is waiting for review." columns={[
          { key: "t", header: "Product", render: (p) => <span className="font-label-md">{p.title}</span> },
          { key: "v", header: "Vendor", render: (p) => p.vendor.storeName },
          { key: "d", header: "Description", render: (p) => <span className="line-clamp-2 max-w-md">{p.description || "-"}</span> },
          { key: "a", header: "", render: (p) => <div className="flex gap-space-xs"><button className={btn.primary} onClick={() => setTarget({ p, to: "approve" })}>Approve</button><button className={btn.ghost} onClick={() => setTarget({ p, to: "reject" })}>Reject</button></div> },
        ]} />
      )}
      <ConfirmDialog open={target?.to === "approve"} title={`Approve ${target?.p.title}?`} body="It becomes visible to every shopper right away." confirmLabel="Approve" onCancel={close} onConfirm={() => void decide()} />
      <FormModal open={target?.to === "reject"} title={`Reject ${target?.p.title}?`} subtitle="The product goes back to the vendor as a draft." submitLabel="Reject product" onSubmit={() => void decide()} onClose={close}>
        <ModalField label="Reason" hint="Tell the vendor what to fix."><textarea className="modal-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required /></ModalField>
      </FormModal>
    </>
  );
}
