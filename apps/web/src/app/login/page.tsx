"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { ROLE_LABELS, type Role } from "@vivaha/shared";

interface Demo { internal: { username: string; name: string; role: Role }[]; customers: { username: string; firm: string; group: string; tehsil: string }[] }

export default function LoginPage() {
  const { login, user, loading } = useAuth(); const router = useRouter();
  const [tab, setTab] = useState<"internal" | "customer">("internal");
  const [demo, setDemo] = useState<Demo | null>(null);
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("demo123");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { apiFetch<Demo>("/api/auth/demo-logins").then((d) => { setDemo(d); setUsername(d.internal[0]?.username ?? ""); }).catch(() => null); }, []);
  useEffect(() => { if (!loading && user) router.replace(user.role === "CUSTOMER" ? "/portal" : "/dashboard"); }, [user, loading, router]);
  const switchTab = (t: typeof tab) => { setTab(t); setErr(""); setUsername(t === "internal" ? demo?.internal[0]?.username ?? "" : demo?.customers[0]?.username ?? ""); };
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(""); try { const u = await login(username, password, tab); router.replace(u.role === "CUSTOMER" ? "/portal" : "/dashboard"); } catch (ex) { setErr(ex instanceof Error ? ex.message : "Invalid credentials"); } finally { setBusy(false); } };
  return (
    <div className="login-screen">
      <div className="lg">
        <div className="lg-h"><div className="lg-lo"><div className="m">VC</div><div><div className="n">Vivaha Cards ERP</div><div className="s">Wholesale Operations Suite · Bikaner, Rajasthan</div></div></div></div>
        <div className="lg-t"><div className={tab === "internal" ? "on" : ""} onClick={() => switchTab("internal")}>Internal (Office)</div><div className={tab === "customer" ? "on" : ""} onClick={() => switchTab("customer")}>Customer Portal</div></div>
        <form className="lg-b" onSubmit={submit}>
          <div className="fd"><label>{tab === "internal" ? "Select role / user" : "Username"}</label>
            {demo ? <select value={username} onChange={(e) => setUsername(e.target.value)}>
              {tab === "internal" ? demo.internal.map((u) => <option key={u.username} value={u.username}>{u.name} — {ROLE_LABELS[u.role]}</option>) : demo.customers.map((c) => <option key={c.username} value={c.username}>{c.firm} — {c.group} · {c.tehsil}</option>)}
            </select> : <input value={username} onChange={(e) => setUsername(e.target.value)} />}
          </div>
          <div className="fd"><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <button className="b b-p b-f" disabled={busy}>{tab === "internal" ? "Sign in to ERP" : "Sign in to Wholesale Portal"}</button>
          <div className="lg-d">{tab === "internal" ? <>Demo mode — pick any role, password prefilled (<b>demo123</b>). The role decides which modules and actions are available (RBAC).</> : <>Three demo firms, each with a different pricing group, credit position and machine profile — so rates and stock bands differ per login.</>}</div>
          {err && <div className="lg-e" style={{ display: "block" }}>{err}</div>}
        </form>
      </div>
    </div>
  );
}
