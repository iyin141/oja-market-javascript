import { notFound } from "next/navigation";
import { FakePayInner } from "@/components/FakePay";
import { Shell } from "@/components/Shell";
import { USE_FIXTURES } from "@/lib/env";

/**
 * The fake payment page exists only when it can be used: dev builds, NEXT_PUBLIC_USE_FIXTURES=1, or a deployment whose API runs
 * PAYMENT_PROVIDER=fake and which was built with NEXT_PUBLIC_PAYMENT_PROVIDER=fake. Otherwise production shows not-found.
 */
const enabled = process.env.NODE_ENV !== "production" || USE_FIXTURES || process.env.NEXT_PUBLIC_PAYMENT_PROVIDER === "fake";

export default function FakePay() {
  if (!enabled) notFound();
  return <Shell wide={false}><FakePayInner /></Shell>;
}
