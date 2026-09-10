"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

const cache = new Map<string, string>();

/** Renders a code as a scannable QR. Cached, because a stock page draws 14 of them. */
export function Qr({ value, size = 96, className, style }: { value: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const key = `${value}|${size}`;
  const [src, setSrc] = useState<string | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    let live = true;
    const hit = cache.get(key);
    if (hit) { setSrc(hit); return; }
    QRCode.toDataURL(value, { width: size * 2, margin: 0, errorCorrectionLevel: "M", color: { dark: "#0A101C", light: "#FFFFFF" } })
      .then((d) => { cache.set(key, d); if (live) setSrc(d); })
      .catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [value, size, key]);
  if (!src) return <div className={className} style={{ width: size, height: size, background: "var(--nu-bg)", borderRadius: 3, ...style }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`QR code for ${value}`} width={size} height={size} className={className} style={{ display: "block", imageRendering: "pixelated", ...style }} />;
}
