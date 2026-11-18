import { Suspense } from "react";
import { OrdersList } from "@/components/OrderViews";
import { Shell } from "@/components/Shell";

export default function OrdersPage() {
  return <Shell><Suspense><OrdersList /></Suspense></Shell>;
}
