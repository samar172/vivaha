// The service worker exists for two reasons, and deliberately does no more than
// those two things.
//
//  1. Installability. Chrome on Android will not offer "Add to home screen" for
//     a page that has no service worker with a fetch handler, however complete
//     the manifest is.
//  2. A readable offline screen. A godown on the edge of the network drops out
//     mid-shift; a dinosaur is worse than a line of Hindi saying the connection
//     went and the app will come back.
//
// It does NOT cache API responses. This is an ERP: a stale stock figure or a
// stale credit gate read back from a cache would be worse than an error. Only
// the static build output is cached, and only after it has been fetched once.

const CACHE = "vivaha-shell-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/icon-") ||
  url.pathname === "/apple-touch-icon.png" ||
  url.pathname.endsWith(".webmanifest");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never serve business data from a cache.
  if (url.pathname.startsWith("/api/")) return;

  // Build output is content-hashed, so cache-first is safe and makes a cold
  // start on a 3G handset feel like a warm one.
  if (isStatic(url)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
    return;
  }

  // Everything else — the pages themselves — is network-only, with the offline
  // card as the fallback for a navigation that cannot be served.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || new Response("Offline", { status: 503 }))));
  }
});
