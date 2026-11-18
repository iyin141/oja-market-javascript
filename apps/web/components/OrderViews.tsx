"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { API_URL, apiStrict } from "@/lib/api";
import { FIXTURE_ORDERS, pick } from "@/lib/fixtures";
import { formatKobo } from "@/lib/money";
import { getToken } from "@/lib/session";
import type { Order, SubOrderStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useAuth } from "@/lib/useAuth";
import { ConfirmDialog } from "./interactive";
import { FormModal, ModalField } from "./Modal";
import { SignInPrompt } from "./RoleGuard";
import { btn, Icon, Notice, PageTitle, StatusChip, Timeline, VendorGroup } from "./ui";

const FLOW: SubOrderStatus[] = ["PAID", "PACKED", "SHIPPED", "DELIVERED"];

type PayState = { kind: "checking" } | { kind: "PAID"; orderId: string } | { kind: "PENDING"; orderId: string } | { kind: "FAILED"; orderId: string } | { kind: "error"; message: string };

/** Result of the payment the customer just made. Paystack sends them back to /orders?reference=...; the API asks Paystack and updates the order. */
export function PaymentResult({ reference, onDone }: { reference: string; onDone: () => void }) {
  const [s, setS] = useState<PayState>({ kind: "checking" });
  const check = useCallback(async () => {
    setS({ kind: "checking" });
    try {
      const r = await apiStrict<{ status: "PAID" | "PENDING" | "FAILED"; orderId: string }>("/payments/paystack/verify", { method: "POST", token: getToken(), body: JSON.stringify({ reference }) });
      setS({ kind: r.status, orderId: r.orderId });
      onDone();
    } catch (e) { setS({ kind: "error", message: e instanceof Error ? e.message : "Could not check the payment" }); }
  }, [reference, onDone]);
  useEffect(() => { void check(); }, [check]);
  const box = "rounded-xl p-space-md mb-space-md flex flex-wrap items-center gap-space-sm";
  if (s.kind === "checking") return <p role="status" className={`${box} bg-surface-card text-text-secondary`}>Checking your payment...</p>;
  if (s.kind === "PAID") return <div role="status" className={`${box} bg-status-success/10 text-status-success`}><Icon name="check_circle" /><span className="font-label-md">Payment received. Thank you, your order is confirmed.</span><Link href={`/orders/${s.orderId}`} className={btn.primary}>View order</Link></div>;
  if (s.kind === "PENDING") return <div role="status" className={`${box} bg-status-warning/10 text-status-warning`}><Icon name="hourglass_top" /><span className="font-label-md">Your payment is still being confirmed. This can take a minute.</span><button className={btn.ghost} onClick={() => void check()}>Check again</button></div>;
  if (s.kind === "FAILED") return <div role="alert" className={`${box} bg-status-danger/10 text-status-danger`}><Icon name="error" /><span className="font-label-md">The payment did not go through, so you were not charged for this order.</span><Link href="/checkout" className={btn.ghost}>Try again</Link></div>;
  return <div role="alert" className={`${box} bg-status-danger/10 text-status-danger`}><Icon name="error" /><span className="font-label-md">{s.message}</span><button className={btn.ghost} onClick={() => void check()}>Check again</button></div>;
}

export function OrdersList() {
  const params = useSearchParams();
  const reference = params.get("reference") ?? params.get("trxref");
  const { user, ready } = useAuth();
  const { data, live, loading, reload } = useApi<Order[]>("/orders", pick([], FIXTURE_ORDERS));
  if (!ready) return <p role="status" className="text-text-secondary">Loading...</p>;
  if (!user) return <SignInPrompt next={reference ? `/orders?reference=${encodeURIComponent(reference)}` : "/orders"} text="Sign in to see your orders." />;
  return (
    <>
      <Notice live={live} />
      {reference && <PaymentResult reference={reference} onDone={reload} />}
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
  const { user, ready } = useAuth();
  const { data: order, live, loading, status, reload } = useApi<Order | null>(`/orders/${id}`, pick(null, FIXTURE_ORDERS.find((o) => o.id === id) ?? null));
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
  /** Fetch with the bearer token and save the blob: an <a href> would not carry the Authorization header. */
  async function downloadInvoice() {
    try {
      const r = await fetch(`${API_URL}/orders/${id}/invoice`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!r.ok) throw new Error(`Invoice unavailable (${r.status})`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = `invoice-${id.slice(0, 8)}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e2) { setMsg(e2 instanceof Error ? e2.message : "Invoice failed"); }
  }
  async function ret() {
    if (!retFor || reason.trim().length < 5) { setRetErr("Please describe the problem (at least 5 characters)."); return; }
    try { await apiStrict(`/orders/${id}/returns`, { method: "POST", token: getToken(), body: JSON.stringify({ subOrderId: retFor, reason: reason.trim() }) }); setRetErr(""); setRetFor(null); setReason(""); reload(); }
    catch (e2) { setRetErr(e2 instanceof Error ? e2.message : "Return failed"); }
  }
  if (!ready || loading) return <p role="status" className="text-text-secondary">Loading order...</p>;
  if (!user) return <SignInPrompt next={`/orders/${id}`} text="Sign in to see this order." />;
  if (!order) {
    return (
      <div role="alert" className="max-w-md mx-auto bg-surface-card rounded-xl shadow-sm p-space-lg text-center flex flex-col items-center gap-space-sm">
        <Icon name="search_off" className="text-[40px] text-text-secondary" />
        <h1 className="font-headline-md text-headline-md">{status === 404 ? "Order not found" : "Order could not be loaded"}</h1>
        <p className="font-body-sm text-body-sm text-text-secondary">{status === 404 ? "This order does not exist or belongs to another account." : "Something went wrong while loading this order. Please try again."}</p>
        <Link href="/orders" className={btn.primary}>Back to your orders</Link>
      </div>
    );
  }
  return (
    <>
      <Notice live={live} />
      <PageTitle title={`Order ${order.id.slice(0, 8)}`} sub={`${order.paymentMethod === "COD" ? "Pay on delivery" : "Paid by card"} - total ${formatKobo(order.totalKobo)}`} actions={<div className="flex items-center gap-space-sm"><button className={btn.ghost} onClick={() => void downloadInvoice()}>Download invoice (PDF)</button><StatusChip status={order.status} /></div>} />
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
