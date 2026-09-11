import { JobDetail } from "../page";

// A job opens on its own page rather than a side drawer.
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobDetail id={id} />;
}
