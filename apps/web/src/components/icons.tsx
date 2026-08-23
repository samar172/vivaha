import type { CSSProperties, ReactNode } from "react";

/* Stroke icons on a 24px grid, drawn in currentColor so they take the colour of
   whatever they sit in. Kept inline — no icon package, same as the rest of the UI. */

export type IconName =
  | "grid" | "tag" | "inbox" | "warehouse" | "users" | "receipt" | "truck" | "printer" | "undo"
  | "rupee" | "chart" | "history" | "sliders" | "menu" | "pin" | "search" | "bell" | "user"
  | "x" | "check" | "alert" | "info" | "camera" | "swap" | "download" | "chevronL" | "chevronR" | "chevronD";

const D: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.4" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4" /></>,
  tag: <><path d="M12.6 2.6 21 11a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6Z" /><circle cx="7.4" cy="7.4" r="1.4" /></>,
  inbox: <><path d="M22 12h-5.5l-1.6 2.6a1 1 0 0 1-.9.4h-4a1 1 0 0 1-.9-.4L7.5 12H2" /><path d="M5.6 4.9 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.6-7.1a2 2 0 0 0-1.8-1.1H7.4a2 2 0 0 0-1.8 1.1Z" /></>,
  warehouse: <><path d="M2 21V9.2a2 2 0 0 1 1.3-1.9l8-3a2 2 0 0 1 1.4 0l8 3A2 2 0 0 1 22 9.2V21" /><path d="M2 21h20" /><path d="M6.5 21v-7.5h11V21" /><path d="M6.5 17.2h11" /></>,
  users: <><path d="M15.5 21v-1.8a4 4 0 0 0-4-4h-5a4 4 0 0 0-4 4V21" /><circle cx="9" cy="7.5" r="3.8" /><path d="M22 21v-1.8a4 4 0 0 0-3-3.9" /><path d="M16.5 3.9a4 4 0 0 1 0 7.4" /></>,
  receipt: <><path d="M5 2.6v18.8l2.3-1.4L9.7 21.4 12 20l2.3 1.4 2.4-1.4 2.3 1.4V2.6l-2.3 1.4L14.3 2.6 12 4 9.7 2.6 7.3 4Z" /><path d="M8.6 8.4h6.8" /><path d="M8.6 12h6.8" /><path d="M8.6 15.6h4.2" /></>,
  truck: <><path d="M14.5 17.5V6.4a1 1 0 0 0-1-1H2.6a1 1 0 0 0-1 1v10.1a1 1 0 0 0 1 1h1.3" /><path d="M14.5 9.2h4.2a1 1 0 0 1 .8.4l2.7 3.6a1 1 0 0 1 .2.6v3.1a1 1 0 0 1-1 1h-1.1" /><circle cx="6.6" cy="17.9" r="2.3" /><circle cx="17.6" cy="17.9" r="2.3" /><path d="M8.9 17.9h6.4" /></>,
  printer: <><path d="M6.5 9V3.4h11V9" /><path d="M6.5 18.4H4.6a2 2 0 0 1-2-2v-4.9a2 2 0 0 1 2-2h14.8a2 2 0 0 1 2 2v4.9a2 2 0 0 1-2 2h-1.9" /><rect x="6.5" y="14.2" width="11" height="6.4" rx="1" /></>,
  undo: <><path d="M3.2 12a8.8 8.8 0 1 0 2.9-6.5L3 8.3" /><path d="M3 3.4v5h5" /></>,
  rupee: <><path d="M6.4 3.6h11.2" /><path d="M6.4 8.2h11.2" /><path d="M6.4 12.8h3.2c4.9 0 4.9-9.2 0-9.2" /><path d="m9.6 12.8 7.4 7.6" /></>,
  chart: <><path d="M3.4 3.2v15.2a2 2 0 0 0 2 2h15.2" /><path d="m7.6 15.4 3.7-4.1 2.9 2.6 4.6-5.6" /></>,
  history: <><path d="M3.2 12a8.8 8.8 0 1 0 2.9-6.5L3 8.3" /><path d="M3 3.4v5h5" /><path d="M12 7.6V12l2.9 1.8" /></>,
  sliders: <><path d="M20.4 7.2h-8.6" /><path d="M14.6 16.8H3.6" /><circle cx="17.4" cy="16.8" r="2.9" /><circle cx="7.4" cy="7.2" r="2.9" /></>,
  menu: <><path d="M3.6 6.4h16.8" /><path d="M3.6 12h16.8" /><path d="M3.6 17.6h16.8" /></>,
  pin: <><path d="M19.8 10.2c0 5.6-7.8 11.4-7.8 11.4S4.2 15.8 4.2 10.2a7.8 7.8 0 0 1 15.6 0Z" /><circle cx="12" cy="10" r="2.9" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.9" /><path d="m20.2 20.2-3.6-3.6" /></>,
  bell: <><path d="M18.2 8.6a6.2 6.2 0 1 0-12.4 0c0 6.7-2.8 8.6-2.8 8.6h18s-2.8-1.9-2.8-8.6" /><path d="M13.8 20.6a2.1 2.1 0 0 1-3.6 0" /></>,
  user: <><circle cx="12" cy="8" r="4.1" /><path d="M4.2 20.8v-.9a5.8 5.8 0 0 1 5.8-5.8h4a5.8 5.8 0 0 1 5.8 5.8v.9" /></>,
  x: <><path d="M18.2 5.8 5.8 18.2" /><path d="m5.8 5.8 12.4 12.4" /></>,
  check: <path d="M20 6.4 9.4 17.6 4 12.2" />,
  alert: <><path d="M10.3 4 2 18.2a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z" /><path d="M12 9.4v4.4" /><path d="M12 17.4h.01" /></>,
  info: <><circle cx="12" cy="12" r="8.8" /><path d="M12 16.4V11.6" /><path d="M12 8h.01" /></>,
  camera: <><path d="M15.1 4.2H8.9L7.4 6.6H4.2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h15.6a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-3.2Z" /><circle cx="12" cy="13.1" r="3.6" /></>,
  swap: <><path d="M7.8 3.4 3.6 7.6l4.2 4.2" /><path d="M3.6 7.6h16.8" /><path d="m16.2 20.6 4.2-4.2-4.2-4.2" /><path d="M20.4 16.4H3.6" /></>,
  download: <><path d="M12 3.4v11.8" /><path d="m7.2 11.4 4.8 4.8 4.8-4.8" /><path d="M4 20.6h16" /></>,
  chevronL: <path d="m14.6 5.8-6.2 6.2 6.2 6.2" />,
  chevronR: <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />,
  chevronD: <path d="m5.8 9.4 6.2 6.2 6.2-6.2" />,
};

export function Icon({ n, s = 16, w = 1.7, style, className }: { n: IconName; s?: number; w?: number; style?: CSSProperties; className?: string }) {
  return (
    <svg className={className} style={{ flexShrink: 0, display: "block", ...style }} width={s} height={s} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{D[n]}</svg>
  );
}

/** Status glyph shared by toasts and notification rows. */
export const KIND_ICON: Record<string, IconName> = { WARN: "alert", OK: "check", ERR: "x", INFO: "info", s: "check", e: "x", w: "alert", i: "info" };
