import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { UIProvider } from "@/lib/ui";
import { AppStateProvider } from "@/lib/app-state";

export const metadata: Metadata = { title: "Vivaha Cards ERP — Wholesale Operations Suite", description: "Wholesale operations suite for Vivaha Cards, Bikaner" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" />
      </head>
      <body><AuthProvider><AppStateProvider><UIProvider>{children}</UIProvider></AppStateProvider></AuthProvider></body>
    </html>
  );
}
