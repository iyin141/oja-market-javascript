import { OrderDetail } from "@/components/OrderViews";
import { Shell } from "@/components/Shell";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Shell><OrderDetail id={id} /></Shell>;
}
