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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={devanagari.variable}>
      <body><AuthProvider><AppStateProvider><UIProvider>{children}</UIProvider></AppStateProvider></AuthProvider></body>
    </html>
  );
}
