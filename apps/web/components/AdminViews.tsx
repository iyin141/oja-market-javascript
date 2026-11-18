"use client";
import { useMemo, useState } from "react";
import { apiStrict } from "@/lib/api";
import { FIXTURE_KPIS } from "@/lib/fixtures";
import { formatKobo } from "@/lib/money";
import { getToken } from "@/lib/session";
import type { Kpis } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { SeriesChart, type Series } from "./Chart";
import { ConfirmDialog } from "./interactive";
import { btn, Column, DataTable, Icon, Notice, PageTitle, StatTile, StatusChip } from "./ui";

export function AdminDashboard() {
  const { data: k, live } = useApi<Kpis>("/admin/kpis", FIXTURE_KPIS);
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
        <StatTile label="Products in review" value={k.pendingProducts} icon="fact_check" />
        <StatTile label="Flagged vendors" value={k.flaggedVendors} icon="flag" />
        <StatTile label="Ledger check" value={<span className={k.ledger.ok ? "text-status-success" : "text-status-danger"}>{k.ledger.ok ? "Balanced" : "MISMATCH"}</span>} icon="balance"
          hint={`Dr ${formatKobo(k.ledger.totalDebits)} / Cr ${formatKobo(k.ledger.totalCredits)}`} />
      </div>
    </>
  );
}

interface VendorRow { id: string; storeName: string; status: string; flagged: boolean; score: number; user: { email: string } }
const FX_VENDORS: VendorRow[] = [{ id: "v1", storeName: "Zeta Gadgets", status: "KYC_SUBMITTED", flagged: false, score: 100, user: { email: "zeta@example.com" } }];

export function AdminVendors() {
  const { data, live, reload } = useApi<VendorRow[]>("/admin/vendors", FX_VENDORS);
  const [target, setTarget] = useState<{ v: VendorRow; to: "approve" | "reject" } | null>(null);
  const [err, setErr] = useState("");
  async function decide() {
    if (!target) return;
    try { await apiStrict(`/admin/vendors/${target.v.id}/${target.to}`, { method: "POST", token: getToken(), body: JSON.stringify(target.to === "reject" ? { note: "Document unclear, please resubmit" } : {}) }); setErr(""); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setTarget(null);
  }
  async function viewKyc(v: VendorRow) {
    try { const r = await apiStrict<{ url: string }>(`/admin/vendors/${v.id}/kyc-url`, { token: getToken() }); window.open(r.url, "_blank", "noopener"); }
    catch (e) { setErr(e instanceof Error ? e.message : "No document"); }
  }
  const cols: Column<VendorRow>[] = [
    { key: "n", header: "Store", render: (v) => <span className="font-label-md">{v.storeName}</span> },
    { key: "e", header: "Owner", render: (v) => v.user.email },
    { key: "s", header: "Status", render: (v) => <StatusChip label={v.status.replace("_", " ")} tone={v.status === "APPROVED" ? "success" : v.status === "KYC_SUBMITTED" ? "warning" : "neutral"} /> },
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
      <ConfirmDialog open={!!target} danger={target?.to === "reject"} title={`${target?.to === "approve" ? "Approve" : "Reject"} ${target?.v.storeName}?`}
        body={target?.to === "approve" ? "The vendor can start listing products immediately." : "The vendor is told to resubmit their document."} confirmLabel={target?.to === "approve" ? "Approve" : "Reject"}
        onCancel={() => setTarget(null)} onConfirm={decide} />
    </>
  );
}

interface Dispute { id: string; reason: string; vendorResponse: string | null; subOrder: { subtotalKobo: string; vendor: { storeName: string } } }
const FX_DISPUTES: Dispute[] = [{ id: "d1", reason: "Arrived damaged", vendorResponse: "Item was fine", subOrder: { subtotalKobo: "8500000", vendor: { storeName: "Lagos Gadget Hub" } } }];

export function AdminDisputes() {
  const { data, live, reload } = useApi<Dispute[]>("/admin/disputes", FX_DISPUTES);
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
