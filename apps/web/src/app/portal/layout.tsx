"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { PortalProvider, usePortal } from "@/components/portal/PortalContext";
import { SheetOverlay } from "@/components/portal/Sheet";
import { FirstLoginGate } from "@/components/FirstLogin";
import { LangProvider, useLang } from "@/lib/i18n";
import { InstallApp } from "@/components/InstallApp";

// Home | Shop | Cart | Orders | Profile, over the routes that already exist.
// Cart is not a route — it is the sheet the header button has always opened —
// so it sits in the bar as a button rather than as a duplicated page.
const PNAV: [string, string, string][] = [
  ["/portal", "home", "⌂"],
  ["/portal/cat", "shop", "▤"],
  ["__cart", "cart", "🛒"],
  ["/portal/orders", "orders", "🧾"],
  ["/portal/account", "profile", "₹"],
];
function Frame({ children }: { children: React.ReactNode }) {
  const P = usePortal(); const { logout } = useAuth(); const router = useRouter(); const path = usePathname(); const { lang, setLang, t } = useLang();
  return <div className="portal">
    <div className="ph"><div className="lo"><div className="m">VC</div><div><div className="t">Vivaha Cards</div><div className="s">{P.me!.firm.name}</div></div></div><div className="sp"><button className="cbt" title={t("language")} style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".02em" }} onClick={() => setLang(lang === "hi" ? "en" : "hi")}>{lang === "hi" ? "EN" : "हिं"}</button><button className="cbt" onClick={P.openCart}>🛒{!!P.cart?.count && <span className="c">{P.cart.count}</span>}</button><button className="cbt" onClick={() => logout().then(() => router.replace("/login"))} title="Sign out" style={{ fontSize: 15.5 }}>↩</button></div></div>
    <div className="plsw">{P.me!.lines.map((l) => <button key={l.id} className={P.line === l.id ? "on" : ""} style={P.line === l.id ? { color: l.color } : undefined} onClick={() => P.setLine(l.id)}>{l.icon} <span className={lang === "hi" ? "hi" : ""}>{lang === "hi" ? l.nameHi : l.name}</span></button>)}</div>
    <div className="pbody"><div className="pc">{children}</div></div>
    <nav className="pnav">{PNAV.map(([h, key, i]) => h === "__cart"
      ? <button key={h} className={"pnavb" + (P.cartOpen ? " on" : "")} onClick={P.openCart}><span className="i">{i}{!!P.cart?.count && <span className="nb">{P.cart.count}</span>}</span><span className={lang === "hi" ? "hi" : ""}>{t(key)}</span></button>
      : <Link key={h} href={h} className={path === h ? "on" : ""}><span className="i">{i}</span><span className={lang === "hi" ? "hi" : ""}>{t(key)}</span></Link>)}</nav>
    <SheetOverlay />
    {/* The shop installs as its own app, in the language the shop is being read in. */}
    <InstallApp hindi={lang === "hi"} manifest="/portal.webmanifest" />
  </div>;
}
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  // A freshly issued portal password has to be replaced before the shop can be
  // used, so this sits outside the provider and does not wait on portal data.
  if (loading) return <div className="loading">Loading…</div>;
  if (user?.mustChangePassword) return <FirstLoginGate hindi />;
  return <LangProvider><PortalProvider><Frame>{children}</Frame></PortalProvider></LangProvider>;
}
