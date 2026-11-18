"use client";
import { useState, type FormEvent } from "react";
import { apiStrict } from "@/lib/api";
import { getToken } from "@/lib/session";
import { btn, Icon, inputCls, PageTitle } from "./ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Delivery agent screen. The API has no "my deliveries" list, only POST /agent/sub-orders/:id/deliver,
 * so the agent enters the shipment (sub-order) id from the delivery slip and says whether cash was collected.
 */
export function AgentDeliver() {
  const [id, setId] = useState("");
  const [cash, setCash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string[]>([]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const sid = id.trim();
    if (!UUID.test(sid)) { setErr("That is not a valid shipment id. Copy it exactly from the delivery slip."); return; }
    setBusy(true); setErr("");
    try {
      await apiStrict(`/agent/sub-orders/${sid}/deliver`, { method: "POST", token: getToken(), body: JSON.stringify({ cashCollected: cash }) });
      setDone((d) => [sid, ...d]); setId(""); setCash(false);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not mark as delivered"); }
    setBusy(false);
  }
  return (
    <>
      <PageTitle title="Deliveries" sub="Mark a shipment as delivered once the customer has it." />
      <form onSubmit={submit} className="bg-surface-card rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md">
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Shipment id
          <input className={inputCls} value={id} onChange={(e) => setId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" spellCheck={false} required /></label>
        <label className="flex items-center gap-space-xs font-label-md text-label-md"><input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} />I collected the cash (pay-on-delivery orders)</label>
        {err && <p role="alert" className="text-status-danger font-label-md">{err}</p>}
        <button className={`${btn.primary} self-start`} disabled={busy}>{busy ? "Saving..." : "Mark as delivered"}</button>
      </form>
      {done.length > 0 && (
        <ul role="status" className="mt-space-md flex flex-col gap-space-xs font-body-sm text-body-sm text-status-success">
          {done.map((d) => <li key={d} className="flex items-center gap-space-xs"><Icon name="check_circle" className="text-[18px]" />Delivered: {d}</li>)}
        </ul>
      )}
    </>
  );
}
