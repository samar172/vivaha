import { VendorLedger } from "@/components/VendorLedger";

// A supplier opens on its own page, the way a firm does.
export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorLedger id={id} />;
}
