"use client";
import Link from "next/link";
import { useState } from "react";
import { apiStrict } from "@/lib/api";
import { FIXTURE_ORDERS } from "@/lib/fixtures";
import { formatKobo } from "@/lib/money";
import { getToken } from "@/lib/session";
import type { Order, SubOrderStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ConfirmDialog } from "./interactive";
import { FormModal, ModalField } from "./Modal";
import { btn, Notice, PageTitle, StatusChip, Timeline, VendorGroup } from "./ui";

const FLOW: SubOrderStatus[] = ["PAID", "PACKED", "SHIPPED", "DELIVERED"];

export function OrdersList() {
  const { data, live, loading } = useApi<Order[]>("/orders", FIXTURE_ORDERS);
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Your orders" sub="One checkout can ship from several vendors." />
      {loading ? <p role="status" className="text-text-secondary">Loading orders...</p> : (
        <div className="flex flex-col gap-space-md">
          {data.length === 0 && <p className="bg-surface-card rounded-xl p-space-xl text-center text-text-secondary">No orders yet.</p>}
          {data.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="bg-surface-card rounded-xl p-space-md shadow-sm hover:shadow-md flex flex-wrap items-center justify-between gap-space-md">
              <div className="flex flex-col"><span className="font-label-md text-label-md text-text-primary">Order {o.id.slice(0, 8)}</span>
                <span className="font-caption text-caption text-text-secondary">{new Date(o.createdAt).toLocaleDateString()} - {o.subOrders.length} shipment{o.subOrders.length === 1 ? "" : "s"}</span></div>
              <StatusChip status={o.status} />
              <span className="font-title-sm text-title-sm font-bold">{formatKobo(o.totalKobo)}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const { data: order, live, loading, reload } = useApi<Order>(`/orders/${id}`, FIXTURE_ORDERS.find((o) => o.id === id) ?? FIXTURE_ORDERS[0]);
  const [confirm, setConfirm] = useState<{ subId: string; kind: "CONFIRM_DELIVERY" | "CANCEL" } | null>(null);
  const [msg, setMsg] = useState("");
  async function act() {
    if (!confirm) return;
    try { await apiStrict(`/orders/${id}/events`, { method: "POST", token: getToken(), body: JSON.stringify({ type: confirm.kind, subOrderId: confirm.subId }) }); setMsg(""); reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Action failed"); }
    setConfirm(null);
  }
  const [retFor, setRetFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [retErr, setRetErr] = useState("");
  async function ret() {
    if (!retFor || reason.trim().length < 5) { setRetErr("Please describe the problem (at least 5 characters)."); return; }
    try { await apiStrict(`/orders/${id}/returns`, { method: "POST", token: getToken(), body: JSON.stringify({ subOrderId: retFor, reason: reason.trim() }) }); setRetErr(""); setRetFor(null); setReason(""); reload(); }
    catch (e2) { setRetErr(e2 instanceof Error ? e2.message : "Return failed"); }
  }
  if (loading) return <p role="status" className="text-text-secondary">Loading order...</p>;
  return (
    <>
      <Notice live={live} />
      <PageTitle title={`Order ${order.id.slice(0, 8)}`} sub={`${order.paymentMethod === "COD" ? "Pay on delivery" : "Paid by card"} - total ${formatKobo(order.totalKobo)}`} actions={<StatusChip status={order.status} />} />
      <FormModal open={!!retFor} title="Request a return" subtitle="Tell the vendor what went wrong." submitLabel="Submit return" error={retErr} onSubmit={() => void ret()} onClose={() => { setRetFor(null); setRetErr(""); }}>
        <ModalField label="Why are you returning this item?" hint="At least 5 characters."><textarea className="modal-input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required /></ModalField>
      </FormModal>
      {msg && <p role="alert" className="text-status-danger mb-space-sm">{msg}</p>}
      <div className="flex flex-col gap-space-md">
        {order.subOrders.map((s) => {
          const at = FLOW.indexOf(s.status === "AWAITING_COLLECTION" ? "PAID" : s.status);
          return (
            <VendorGroup key={s.id} name={s.vendor.storeName} subtotalKobo={s.subtotalKobo}
              footer={
                <div className="flex flex-wrap items-center gap-space-sm justify-between">
                  <StatusChip status={s.status} />
                  <div className="flex gap-space-sm">
                    {s.status === "SHIPPED" && <button className={btn.primary} onClick={() => setConfirm({ subId: s.id, kind: "CONFIRM_DELIVERY" })}>Confirm delivery</button>}
                    {s.status === "DELIVERED" && <button className={btn.ghost} onClick={() => setRetFor(s.id)}>Request return</button>}
                    {["PAID", "PACKED", "AWAITING_COLLECTION", "PENDING_PAYMENT"].includes(s.status) && <button className={btn.ghost} onClick={() => setConfirm({ subId: s.id, kind: "CANCEL" })}>Cancel</button>}
                  </div>
                </div>
              }>
              <div className="py-space-md grid grid-cols-1 md:grid-cols-[1fr_260px] gap-space-md [&>*]:min-w-0">
                <ul className="flex flex-col gap-space-xs">{s.items.map((i) => <li key={i.id} className="flex justify-between font-body-sm text-body-sm"><span>{i.qty} x {i.title}</span><span>{formatKobo(BigInt(i.unitPriceKobo) * BigInt(i.qty))}</span></li>)}</ul>
                <Timeline steps={[
                  { label: "Payment received", done: at >= 0 },
                  { label: "Packed by vendor", done: at >= 1 },
                  { label: "Shipped", done: at >= 2, detail: s.trackingNo ? `${s.courier ?? ""} ${s.trackingNo}` : undefined },
                  { label: "Delivered", done: at >= 3 },
                ]} />
              </div>
            </VendorGroup>
          );
        })}
      </div>
      <ConfirmDialog open={!!confirm} danger={confirm?.kind === "CANCEL"} title={confirm?.kind === "CANCEL" ? "Cancel this shipment?" : "Confirm you received it?"}
        body={confirm?.kind === "CANCEL" ? "Stock is released and any payment is reversed." : "This tells us the vendor can be paid after the return window."}
        confirmLabel={confirm?.kind === "CANCEL" ? "Cancel shipment" : "Yes, received"} onCancel={() => setConfirm(null)} onConfirm={act} />
    </>
  );
}
