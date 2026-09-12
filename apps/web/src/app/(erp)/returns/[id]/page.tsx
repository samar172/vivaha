import { ReturnDetail } from "../page";

// A return opens on its own page rather than a side drawer.
export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnDetail id={id} />;
}
