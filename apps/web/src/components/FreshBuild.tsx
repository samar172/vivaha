"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// "It is deployed, but I still see the old screen."
//
// A single-page app does not re-fetch its own JavaScript when you click around
// inside it. A tab left open since the morning — or an installed app that was
// never closed — keeps running the morning's build indefinitely, so a fix that
// is live and working still looks broken to the person who asked for it. We lost
// a round trip to exactly that.
//
// This asks the server which build it is serving, whenever the tab comes back
// into focus and every few minutes besides. When the answer differs from the
// build this page started as, two things happen:
//
//   * a bar appears, because somebody mid-way through typing an order should
//     decide when to interrupt themselves; and
//   * the next time they navigate anywhere, the app reloads properly instead of
//     routing on the client — so in practice it fixes itself on the next click
//     and the bar is only for those who want it now.

const CHECK_EVERY = 3 * 60_000;

export function FreshBuild() {
  const mine = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
  const [stale, setStale] = useState(false);
  const path = usePathname();
  const staleRef = useRef(false);
  const firstPath = useRef(path);

  useEffect(() => {
    if (mine === "dev") return;
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch("/build-id", { cache: "no-store" });
        if (!r.ok) return;
        const { build } = (await r.json()) as { build: string };
        if (alive && build && build !== mine) { staleRef.current = true; setStale(true); }
      } catch { /* offline, or the deploy is mid-flight — ask again later */ }
    };
    const onFocus = () => { if (document.visibilityState === "visible") check(); };
    const t = setInterval(check, CHECK_EVERY);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    check();
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [mine]);

  // Navigating while stale is the natural moment to pick up the new build: the
  // screen was going to change anyway, so nothing is interrupted.
  useEffect(() => {
    if (staleRef.current && path !== firstPath.current) window.location.reload();
  }, [path]);

  if (!stale) return null;
  return (
    <div className="fbld" role="status">
      <span>A newer version of this app is ready.</span>
      <button className="b b-p b-s" onClick={() => window.location.reload()}>Reload now</button>
      <button className="fbldx" onClick={() => setStale(false)} aria-label="Dismiss">×</button>
    </div>
  );
}
