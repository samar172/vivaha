"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { PortalProvider, usePortal } from "@/components/portal/PortalContext";
import { SheetOverlay } from "@/components/portal/Sheet";

const PNAV = [["/portal", "होम", "⌂"], ["/portal/kit", "किट", "▤"], ["/portal/orders", "ऑर्डर", "🧾"], ["/portal/account", "खाता", "₹"]];
function Frame({ children }: { children: React.ReactNode }) {
  const P = usePortal(); const { logout } = useAuth(); const router = useRouter(); const path = usePathname();
  return <div className="portal">
    <div className="ph"><div className="lo"><div className="m">VC</div><div><div className="t">Vivaha Cards</div><div className="s">{P.me!.firm.name}</div></div></div><div className="sp"><button className="cbt" onClick={P.openCart}>🛒{!!P.cart?.count && <span className="c">{P.cart.count}</span>}</button><button className="cbt" onClick={() => logout().then(() => router.replace("/login"))} title="Sign out" style={{ fontSize: 14 }}>↩</button></div></div>
    <div className="plsw">{P.me!.lines.map((l) => <button key={l.id} className={P.line === l.id ? "on" : ""} style={P.line === l.id ? { color: l.color } : undefined} onClick={() => P.setLine(l.id)}>{l.icon} <span className="hi">{l.nameHi}</span></button>)}</div>
    <div className="pbody"><div className="pc">{children}</div></div>
    <nav className="pnav">{PNAV.map(([h, l, i]) => <Link key={h} href={h} className={path === h ? "on" : ""}><span className="i">{i}</span><span className="hi">{l}</span></Link>)}</nav>
    <SheetOverlay />
  </div>;
}
export default function PortalLayout({ children }: { children: React.ReactNode }) { return <PortalProvider><Frame>{children}</Frame></PortalProvider>; }
