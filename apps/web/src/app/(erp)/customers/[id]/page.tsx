import { CustomerDetail } from "@/components/CustomerDetail";

// A firm gets its own page rather than a side drawer. Next 15+ hands params in
// as a promise, so the route awaits it and the client component takes the id.
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetail id={id} />;
}
