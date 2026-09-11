import { PurchaseDetail } from "../page";

// A purchase document gets its own page rather than a side drawer.
export default async function PurchaseDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseDetail id={id} />;
}
