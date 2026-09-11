"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

const cache = new Map<string, string>();

/** Renders a code as a scannable QR. Cached, because a stock page draws 14 of them. */
export function Qr({ value, size = 96, className, style }: { value: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const key = `${value}|${size}`;
  const [drawn, setDrawn] = useState<{ key: string; src: string | null }>(() => ({ key, src: cache.get(key) ?? null }));
  // A new value or size is a different code. Read the cache for it in this
  // render rather than setting state from an effect afterwards, which would
  // cost a second pass on every one of the fourteen codes a stock page draws.
  const src = drawn.key === key ? drawn.src : cache.get(key) ?? null;
  if (drawn.key !== key) setDrawn({ key, src });
  useEffect(() => {
    if (cache.has(key)) return;
    let live = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 0, errorCorrectionLevel: "M", color: { dark: "#0A101C", light: "#FFFFFF" } })
      .then((d) => { cache.set(key, d); if (live) setDrawn({ key, src: d }); })
      .catch(() => { if (live) setDrawn({ key, src: null }); });
    return () => { live = false; };
  }, [value, size, key]);
  if (!src) return <div className={className} style={{ width: size, height: size, background: "var(--nu-bg)", borderRadius: 3, ...style }} />;
  return <img src={src} alt={`QR code for ${value}`} width={size} height={size} className={className} style={{ display: "block", imageRendering: "pixelated", ...style }} />;
}
