import type { Metadata, Viewport } from "next";
import { Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

// Latin text is Arial — a system face, nothing to download, and heavier than
// Inter, which is what the operators asked for. Only Devanagari is fetched, and
// through next/font so the file is served from this origin and self-hosted with
// the CSS inlined: a raw <link> to fonts.googleapis.com costs a round trip to
// two extra hosts before any Hindi text can paint.
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-dev",
});
import { AuthProvider } from "@/lib/auth-context";
import { UIProvider } from "@/lib/ui";
import { AppStateProvider } from "@/lib/app-state";
import { ManifestForRoute } from "@/components/ManifestForRoute";

export const metadata: Metadata = {
  title: "Vivaha Cards ERP — Wholesale Operations Suite",
  description: "Wholesale operations suite for Vivaha Cards, Bikaner",
  // The ERP manifest by default; the portal swaps this link for its own, since
  // the two are separate installable apps sharing one origin.
  manifest: "/manifest.webmanifest",
  applicationName: "Vivaha Cards ERP",
  appleWebApp: { capable: true, title: "Vivaha ERP", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#A81F52", width: "device-width", initialScale: 1, viewportFit: "cover" };


// Installability has to be decided before React exists.
//
// Three things were going wrong on phones, none of them visible on a desktop:
//
//  1. Chrome fires `beforeinstallprompt` once, early — often while the page is
//     still hydrating on a handset. React's listener attached afterwards and
//     the event was simply gone. Worse, the old code called preventDefault()
//     on it, which also suppresses Chrome's own mini-infobar — so a missed
//     event left the user with no way in at all. It is captured here instead,
//     in a script that runs while the document is still parsing, and parked on
//     the window for whatever mounts later.
//  2. `/portal` was served with the ERP manifest in its HTML and only swapped
//     to its own after hydration, so a retailer could be offered the office
//     dashboard as an app. The swap happens here, before Chrome reads it.
//  3. The service worker was registered inside the signed-in shell, so a first
//     visit — which lands on /login — had none. Chrome on Android will not
//     offer to install a page with no service worker. It is registered here, on
//     every page, signed in or not.
const BOOT = `
(function () {
  try {
    var portal = location.pathname === '/portal' || location.pathname.indexOf('/portal/') === 0;
    var want = portal ? '/portal.webmanifest' : '/manifest.webmanifest';
    var link = document.querySelector('link[rel="manifest"]');
    if (link && link.getAttribute('href') !== want) link.setAttribute('href', want);

    window.__vivInstall = { evt: null, installed: false };
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      window.__vivInstall.evt = e;
      window.dispatchEvent(new Event('viv:installable'));
    });
    window.addEventListener('appinstalled', function () {
      window.__vivInstall.evt = null;
      window.__vivInstall.installed = true;
      window.dispatchEvent(new Event('viv:installed'));
    });

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
      });
    }
  } catch (err) { /* installability is a nicety; never let it break the page */ }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={devanagari.variable}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <ManifestForRoute />
        <AuthProvider><AppStateProvider><UIProvider>{children}</UIProvider></AppStateProvider></AuthProvider>
      </body>
    </html>
  );
}
