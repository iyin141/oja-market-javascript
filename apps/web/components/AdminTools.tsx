"use client";
import { useState, type FormEvent } from "react";
import { apiStrict } from "@/lib/api";
import { formatKobo } from "@/lib/money";
import { getToken } from "@/lib/session";
import type { Category } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ConfirmDialog, Tabs } from "./interactive";
import { btn, Column, DataTable, inputCls, Notice, PageTitle, StatusChip } from "./ui";

const post = (path: string, body: object = {}) => apiStrict(path, { method: "POST", token: getToken(), body: JSON.stringify(body) });
const nairaToKobo = (n: string) => String(Math.round(Number(n) * 100));

interface VendorRow { id: string; storeName: string; status: string; user: { email: string } }

/** Suspend an approved vendor or reinstate a suspended one (the API allows SUSPENDED -> APPROVED through the approve route). */
function VendorStatus() {
  const { data, live, reload } = useApi<VendorRow[]>("/admin/vendors", []);
  const [target, setTarget] = useState<{ v: VendorRow; to: "suspend" | "approve" } | null>(null);
  const [err, setErr] = useState("");
  async function go() {
    if (!target) return;
    try { await post(`/admin/vendors/${target.v.id}/${target.to}`); setErr(""); reload(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setTarget(null);
  }
  const rows = data.filter((v) => v.status === "APPROVED" || v.status === "SUSPENDED");
  return (
    <>
      <Notice live={live} />
      {err && <p role="alert" className="text-status-danger mb-space-sm">{err}</p>}
      <DataTable rowKey={(v) => v.id} rows={rows} empty="No approved or suspended vendors." columns={[
        { key: "n", header: "Store", render: (v) => <span className="font-label-md">{v.storeName}</span> },
        { key: "e", header: "Owner", render: (v) => v.user.email },
        { key: "s", header: "Status", render: (v) => <StatusChip label={v.status} tone={v.status === "APPROVED" ? "success" : "danger"} /> },
        { key: "a", header: "", render: (v) => v.status === "APPROVED"
          ? <button className={btn.ghost} onClick={() => setTarget({ v, to: "suspend" })}>Suspend</button>
          : <button className={btn.primary} onClick={() => setTarget({ v, to: "approve" })}>Reinstate</button> },
      ]} />
      <ConfirmDialog open={!!target} danger={target?.to === "suspend"} title={`${target?.to === "suspend" ? "Suspend" : "Reinstate"} ${target?.v.storeName}?`}
        body={target?.to === "suspend" ? "Their products leave the shop and they cannot list or ship until reinstated." : "The vendor can sell again."}
        confirmLabel={target?.to === "suspend" ? "Suspend" : "Reinstate"} onCancel={() => setTarget(null)} onConfirm={() => void go()} />
    </>
  );
}

interface Coupon { id: string; code: string; kind: "PERCENT" | "FIXED"; value: string; minSubtotalKobo: string; maxUses: number | null; usedCount: number; expiresAt: string | null; active: boolean }

function Coupons() {
  const { data, live, reload } = useApi<Coupon[]>("/admin/coupons", []);
  const [f, setF] = useState({ code: "", kind: "PERCENT" as "PERCENT" | "FIXED", value: "", min: "", maxUses: "", expires: "" });
  const [err, setErr] = useState("");
  async function create(e: FormEvent) {
    e.preventDefault(); setErr("");
    try {
      const v = Number(f.value);
      if (!(v > 0)) throw new Error("Enter a discount greater than zero");
      await post("/admin/coupons", {
        code: f.code, kind: f.kind, value: f.kind === "PERCENT" ? String(Math.round(v * 100)) : nairaToKobo(f.value),
        ...(f.min ? { minSubtotalKobo: nairaToKobo(f.min) } : {}), ...(f.maxUses ? { maxUses: Number(f.maxUses) } : {}), ...(f.expires ? { expiresAt: new Date(f.expires).toISOString() } : {}),
      });
      setF({ code: "", kind: "PERCENT", value: "", min: "", maxUses: "", expires: "" }); reload();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not create coupon"); }
  }
  const cols: Column<Coupon>[] = [
    { key: "c", header: "Code", render: (c) => <span className="font-label-md">{c.code}</span> },
    { key: "v", header: "Discount", render: (c) => (c.kind === "PERCENT" ? `${Number(c.value) / 100}%` : formatKobo(c.value)) },
    { key: "m", header: "Min spend", render: (c) => formatKobo(c.minSubtotalKobo) },
    { key: "u", header: "Used", render: (c) => `${c.usedCount}${c.maxUses ? ` / ${c.maxUses}` : ""}` },
    { key: "x", header: "Expires", render: (c) => (c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "never") },
    { key: "s", header: "Status", render: (c) => <StatusChip label={c.active ? "Active" : "Off"} tone={c.active ? "success" : "neutral"} /> },
  ];
  return (
    <>
      <Notice live={live} />
      <form onSubmit={create} className="bg-surface-card rounded-xl p-space-md shadow-sm mb-space-md grid grid-cols-2 lg:grid-cols-6 gap-space-sm items-end font-label-sm text-label-sm">
        <label className="flex flex-col gap-1">Code<input className={inputCls} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} pattern="[A-Za-z0-9_\-]{3,40}" required /></label>
        <label className="flex flex-col gap-1">Type<select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "PERCENT" | "FIXED" })}><option value="PERCENT">Percent</option><option value="FIXED">Fixed (naira)</option></select></label>
        <label className="flex flex-col gap-1">{f.kind === "PERCENT" ? "Percent off (max 100)" : "Naira off"}<input className={inputCls} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required /></label>
        <label className="flex flex-col gap-1">Min spend (naira)<input className={inputCls} inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></label>
        <label className="flex flex-col gap-1">Max uses<input className={inputCls} inputMode="numeric" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} /></label>
        <label className="flex flex-col gap-1">Expires<input className={inputCls} type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} /></label>
        <div className="col-span-2 lg:col-span-6 flex items-center gap-space-sm"><button className={btn.primary}>Create coupon</button>{err && <span role="alert" className="text-status-danger">{err}</span>}</div>
      </form>
      <DataTable rowKey={(c) => c.id} rows={data} columns={cols} empty="No coupons yet." />
    </>
  );
}

interface Rule { id: string; categoryId: string | null; bps: number; category: { name: string } | null }

function CommissionRules() {
  const { data, live, reload } = useApi<Rule[]>("/admin/commission-rules", []);
  const cats = useApi<Category[]>("/categories", []);
  const [edit, setEdit] = useState<{ categoryId: string | null; label: string; pct: string } | null>(null);
  const [add, setAdd] = useState("");
  const [err, setErr] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault(); if (!edit) return;
    try {
      const pct = Number(edit.pct);
      if (!(pct >= 0 && pct <= 100)) throw new Error("Percent must be between 0 and 100");
      await apiStrict("/admin/commission-rules", { method: "PUT", token: getToken(), body: JSON.stringify({ categoryId: edit.categoryId, bps: Math.round(pct * 100) }) });
      setErr(""); setEdit(null); reload();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not save"); }
  }
  const free = cats.data.filter((c) => !data.some((r) => r.categoryId === c.id));
  return (
    <>
      <Notice live={live} />
      <p className="font-body-sm text-body-sm text-text-secondary mb-space-sm">Commission the platform keeps per sale. A change only affects new orders. A category without its own rule uses the platform default.</p>
      {err && <p role="alert" className="text-status-danger mb-space-sm">{err}</p>}
      <DataTable rowKey={(r) => r.id} rows={data} empty="No rules yet: add the platform default below." columns={[
        { key: "c", header: "Applies to", render: (r) => r.category?.name ?? "Platform default" },
        { key: "p", header: "Commission", render: (r) => `${r.bps / 100}%` },
        { key: "a", header: "", render: (r) => <button className={btn.ghost} onClick={() => setEdit({ categoryId: r.categoryId, label: r.category?.name ?? "Platform default", pct: String(r.bps / 100) })}>Edit</button> },
      ]} />
      <div className="flex flex-wrap items-end gap-space-sm mt-space-md">
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Add a rule for
          <select className={inputCls} value={add} onChange={(e) => setAdd(e.target.value)}>
            <option value="">Choose...</option>
            {!data.some((r) => r.categoryId === null) && <option value="default">Platform default</option>}
            {free.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <button className={btn.ghost} disabled={!add} onClick={() => { setEdit({ categoryId: add === "default" ? null : add, label: add === "default" ? "Platform default" : cats.data.find((c) => c.id === add)?.name ?? "", pct: "" }); setAdd(""); }}>Add</button>
      </div>
      {edit && (
        <form onSubmit={save} className="bg-surface-card rounded-xl p-space-md shadow-sm mt-space-md flex flex-wrap items-end gap-space-sm">
          <label className="flex flex-col gap-1 font-label-sm text-label-sm">Commission for {edit.label} (%)<input className={inputCls} inputMode="decimal" autoFocus value={edit.pct} onChange={(e) => setEdit({ ...edit, pct: e.target.value })} required /></label>
          <button className={btn.primary}>Save</button><button type="button" className={btn.ghost} onClick={() => setEdit(null)}>Cancel</button>
        </form>
      )}
    </>
  );
}

interface AuditRow { id: string; actorId: string | null; action: string; entity: string; entityId: string; meta: unknown; createdAt: string }

function Audit() {
  const { data, live } = useApi<AuditRow[]>("/admin/audit?limit=100", []);
  return (
    <>
      <Notice live={live} />
      <DataTable rowKey={(r) => String(r.id)} rows={data} empty="Nothing logged yet." columns={[
        { key: "d", header: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
        { key: "a", header: "Action", render: (r) => <span className="font-label-md">{r.action}</span> },
        { key: "e", header: "Entity", render: (r) => `${r.entity} ${r.entityId.slice(0, 8)}` },
        { key: "w", header: "By", render: (r) => (r.actorId ? r.actorId.slice(0, 8) : "system") },
        { key: "m", header: "Details", render: (r) => <span className="text-text-secondary break-all">{r.meta ? JSON.stringify(r.meta) : ""}</span> },
      ]} />
    </>
  );
}

/** Small admin toolbox: vendor suspension, coupons, commission rules, audit log. Flash sales have no list endpoint, so they are not here. */
export function AdminTools() {
  return (
    <>
      <PageTitle title="Admin tools" />
      <Tabs tabs={[
        { id: "vendors", label: "Vendor status", content: <VendorStatus /> },
        { id: "coupons", label: "Coupons", content: <Coupons /> },
        { id: "rules", label: "Commission", content: <CommissionRules /> },
        { id: "audit", label: "Audit log", content: <Audit /> },
      ]} />
    </>
  );
}
