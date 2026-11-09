"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Shell } from "@/components/Shell";
import { btn, Icon } from "@/components/ui";
import { apiStrict } from "@/lib/api";
import { getToken } from "@/lib/session";

/** Stand-in for the hosted payment page when PAYMENT_PROVIDER=fake (dev/test only). */
function Inner() {
  const router = useRouter();
  const ref = useSearchParams().get("reference") ?? "";
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function pay() {
    setBusy(true); setError("");
    try { await apiStrict("/payments/fake/charge", { method: "POST", token: getToken(), body: JSON.stringify({ reference: ref }) }); router.push(`/orders/${ref}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Payment failed"); setBusy(false); }
  }
  return (
    <div className="max-w-md mx-auto bg-surface-card rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md text-center items-center">
      <Icon name="credit_card" className="text-[48px] text-secondary" />
      <h1 className="font-headline-md text-headline-md">Test payment</h1>
      <p className="font-body-sm text-body-sm text-text-secondary">This is the fake payment provider. No money moves. Order {ref.slice(0, 8)}.</p>
      {error && <p role="alert" className="text-status-danger">{error}</p>}
      <button className={btn.primary} onClick={pay} disabled={busy || !ref}>{busy ? "Processing..." : "Pay now"}</button>
    </div>
  );
}
export default function FakePay() {
  return <Shell wide={false}><Suspense><Inner /></Suspense></Shell>;
}
