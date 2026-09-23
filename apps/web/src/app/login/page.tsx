"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { ROLE_LABELS, type Role } from "@vivaha/shared";

// Signing in, with the credentials the office actually issued.
//
// This screen was built for a demo and never grew up: the username was a
// dropdown of accounts the server volunteered and the password came prefilled
// with the shared one. A retailer handed a username and a password by the
// office had nowhere to type either — their firm either appeared in the list or
// they could not get in at all.
//
// So both are typed, on both tabs. The demo pickers still exist, because a demo
// is a real use, but they are off unless the server says DEMO_LOGINS=1 — that
// endpoint is unauthenticated, and on a live system it was handing out every
// office username and every retailer's username, firm, town and pricing group
// to anybody who opened this page.

interface Demo {
  demo?: boolean;
  internal: { username: string; name: string; role: Role }[];
  customers: { username: string; firm: string; group: string; tehsil: string }[];
}

export default function LoginPage() {
  const { login, user, loading } = useAuth(); const router = useRouter();
  const [tab, setTab] = useState<"internal" | "customer">("internal");
  const [demo, setDemo] = useState<Demo | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => { apiFetch<Demo>("/api/auth/demo-logins").then(setDemo).catch(() => null); }, []);
  useEffect(() => { if (!loading && user) router.replace(user.role === "CUSTOMER" ? "/portal" : "/dashboard"); }, [user, loading, router]);

  const isDemo = !!demo?.demo && (demo.internal.length > 0 || demo.customers.length > 0);
  const picks = tab === "internal" ? demo?.internal ?? [] : demo?.customers ?? [];

  const switchTab = (t: typeof tab) => { setTab(t); setErr(""); setUsername(""); setPassword(""); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return setErr("Enter the username and password the office gave you");
    setBusy(true); setErr("");
    try {
      const u = await login(username.trim(), password, tab);
      router.replace(u.role === "CUSTOMER" ? "/portal" : "/dashboard");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Invalid credentials");
    } finally { setBusy(false); }
  };

  return (
    <div className="login-screen">
      <div className="lg">
        <div className="lg-h"><div className="lg-lo"><div className="m">VC</div><div><div className="n">Vivaha Cards ERP</div><div className="s">Wholesale Operations Suite · Bikaner, Rajasthan</div></div></div></div>
        <div className="lg-t">
          <div className={tab === "internal" ? "on" : ""} onClick={() => switchTab("internal")}>Internal (Office)</div>
          <div className={tab === "customer" ? "on" : ""} onClick={() => switchTab("customer")}>Customer Portal</div>
        </div>
        <form className="lg-b" onSubmit={submit}>
          <div className="fd">
            <label htmlFor="lg-user">Username</label>
            <input
              id="lg-user" value={username} autoComplete="username" autoCapitalize="none" autoCorrect="off"
              spellCheck={false} placeholder={tab === "internal" ? "e.g. rahin.accounts" : "The username on your welcome message"}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="fd">
            <label htmlFor="lg-pass">Password</label>
            <div className="lg-pw">
              <input
                id="lg-pass" type={show ? "text" : "password"} value={password} autoComplete="current-password"
                placeholder="The password the office issued"
                onChange={(e) => setPassword(e.target.value)}
              />
              {/* Typed on a phone at a counter, and a wrong password is the
                  commonest reason somebody cannot get in. */}
              <button type="button" className="lg-eye" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button className="b b-p b-f" disabled={busy}>{busy ? "Signing in…" : tab === "internal" ? "Sign in to ERP" : "Sign in to Wholesale Portal"}</button>

          {isDemo && picks.length > 0 && <div className="lg-demo">
            <div className="lb">Demo accounts</div>
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { setUsername(e.target.value); setPassword("demo123"); setErr(""); } }}>
              <option value="">Fill in a demo account…</option>
              {tab === "internal"
                ? demo!.internal.map((u) => <option key={u.username} value={u.username}>{u.name} — {ROLE_LABELS[u.role]}</option>)
                : demo!.customers.map((c) => <option key={c.username} value={c.username}>{c.firm} — {c.group} · {c.tehsil}</option>)}
            </select>
          </div>}

          <div className="lg-d">{tab === "internal"
            ? <>Your username and password are issued by the office under <b>Settings → Users &amp; logins</b>. A new account asks you to set your own password the first time you sign in.</>
            : <>Use the username and password your supplier sent you. Lost them? Ask the office to issue a fresh password — it can be re-sent to the number they have on file.</>}</div>
          {err && <div className="lg-e" style={{ display: "block" }}>{err}</div>}
        </form>
      </div>
    </div>
  );
}
