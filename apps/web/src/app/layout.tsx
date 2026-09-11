import type { Metadata, Viewport } from "next";
import "./globals.css";
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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Latin text is Arial (a system face — no download, and the operators
            asked for something heavier than Inter). Only Devanagari is fetched. */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" />
      </head>
      <body><AuthProvider><AppStateProvider><UIProvider>{children}</UIProvider></AppStateProvider></AuthProvider></body>
    </html>
  );
}
