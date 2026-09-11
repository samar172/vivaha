import { LedgerDetail } from "../page";

// A firm's ledger gets its own page rather than a side drawer.
export default async function LedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LedgerDetail id={id} />;
}
