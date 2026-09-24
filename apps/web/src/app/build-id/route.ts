// What build is being served right now.
//
// Deliberately tiny and deliberately uncached: the running app asks this
// whenever the tab comes back into focus, to find out whether it has been
// superseded. Not under /api, because everything there is proxied to the
// Express API and this is the web app talking about itself.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return new Response(JSON.stringify({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" }), {
    headers: { "content-type": "application/json", "cache-control": "no-store, max-age=0" },
  });
}
