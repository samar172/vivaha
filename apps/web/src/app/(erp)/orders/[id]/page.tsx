import { OrderDetail } from "@/components/OrderDetail";

// An order gets its own page rather than a side drawer.
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetail id={id} />;
}
