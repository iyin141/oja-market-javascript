"use client";
import { useState } from "react";
import { apiStrict } from "@/lib/api";
import { formatKobo } from "@/lib/money";
import { getToken } from "@/lib/session";
import { useApi } from "@/lib/useApi";
import { FormModal, ModalField } from "./Modal";
import { btn, DataTable, Notice, PageTitle, StatusChip } from "./ui";

interface ReturnRow {
  id: string; reason: string; status: "REQUESTED" | "REFUNDED" | "DISPUTED" | "REJECTED"; vendorDeadline: string; vendorResponse: string | null; createdAt: string;
  subOrder: { id: string; subtotalKobo: string; items: { title: string; qty: number }[] };
}
const TONE = { REQUESTED: "warning", REFUNDED: "neutral", DISPUTED: "danger", REJECTED: "success" } as const;
const LABEL = { REQUESTED: "Waiting for you", REFUNDED: "Refunded", DISPUTED: "With admin", REJECTED: "Closed, kept sale" } as const;

/** Customer return requests for this vendor. Accepting refunds the customer; disputing hands it to an admin. Silence for 48h counts as accepting. */
export function SellerReturns() {
  const { data, live, loading, reload } = useApi<ReturnRow[]>("/vendor/returns", []);
  const [target, setTarget] = useState<{ r: ReturnRow; accept: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => { setTarget(null); setNote(""); setErr(""); };
  async function respond() {
    if (!target) return;
    setBusy(true); setErr("");
    try {
      await apiStrict(`/vendor/returns/${target.r.id}/respond`, { method: "POST", token: getToken(), body: JSON.stringify({ accept: target.accept, ...(note.trim() ? { note: note.trim() } : {}) }) });
      close(); reload();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not send your answer"); }
    setBusy(false);
  }
  return (
    <>
      <Notice live={live} />
      <PageTitle title="Returns" sub="Accept to refund the customer now. Dispute if the item is fine: an admin then decides. If you do not answer within 48 hours the refund is issued automatically." />
      {loading ? <p role="status" className="text-text-secondary">Loading returns...</p> : (
        <DataTable rowKey={(r) => r.id} rows={data} empty="No return requests." columns={[
          { key: "i", header: "Items", render: (r) => r.subOrder.items.map((i) => `${i.qty} x ${i.title}`).join(", ") },
          { key: "r", header: "Customer reason", render: (r) => <span className="max-w-xs block">{r.reason}</span> },
          { key: "a", header: "Amount", className: "text-right", render: (r) => formatKobo(r.subOrder.subtotalKobo) },
          { key: "s", header: "Status", render: (r) => <StatusChip label={LABEL[r.status] ?? r.status} tone={TONE[r.status] ?? "neutral"} /> },
          { key: "d", header: "Answer by", render: (r) => (r.status === "REQUESTED" ? new Date(r.vendorDeadline).toLocaleString() : r.vendorResponse ?? "-") },
          { key: "b", header: "", render: (r) => r.status === "REQUESTED" ? <div className="flex gap-space-xs"><button className={btn.primary} onClick={() => setTarget({ r, accept: true })}>Accept and refund</button><button className={btn.ghost} onClick={() => setTarget({ r, accept: false })}>Dispute</button></div> : null },
        ]} />
      )}
      <FormModal open={!!target} busy={busy} error={err} title={target?.accept ? "Accept this return?" : "Dispute this return?"}
        subtitle={target?.accept ? "The customer is refunded in full." : "An admin reviews both sides and decides."} submitLabel={target?.accept ? "Refund customer" : "Send to admin"}
        onSubmit={() => void respond()} onClose={close}>
        <ModalField label={target?.accept ? "Note to the customer (optional)" : "Why is the return not justified?"}><textarea className="modal-input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} required={!target?.accept} /></ModalField>
      </FormModal>
    </>
  );
}
