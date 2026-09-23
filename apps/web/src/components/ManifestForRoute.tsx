"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

// The office and the shop are two installable apps on one origin, and which one
// a browser is being offered has to follow the route.
//
// The boot script sets this at first paint, which is what Chrome reads. But a
// visitor who opens /portal while signed out is bounced to /login without a
// reload, and would otherwise keep being offered the shop; sign in as office
// staff and Chrome would put the retailers' app on the desktop. So the link is
// kept in step with the path for the rest of the session too.
const manifestFor = (path: string) =>
  path === "/portal" || path.startsWith("/portal/") ? "/portal.webmanifest" : "/manifest.webmanifest";

export function ManifestForRoute() {
  const path = usePathname();
  useEffect(() => {
    const want = manifestFor(path ?? "/");
    const el = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (el && el.getAttribute("href") !== want) el.setAttribute("href", want);
  }, [path]);
  return null;
}
