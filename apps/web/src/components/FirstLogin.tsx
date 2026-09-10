"use client";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post } from "@/lib/api";
import { Field, Note } from "./ui";

// Shown instead of the app whenever the office has issued or reset a password.
// The account cannot be used for anything else until the holder replaces it, so
// the password the office can see never stays live.
export function FirstLoginGate({ hindi = false }: { hindi?: boolean }) {
  const { user, reloadUser, logout } = useAuth(); const { toast } = useUI();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const t = hindi
    ? { title: "अपना पासवर्ड बदलिए", lead: "दफ़्तर ने आपको जो पासवर्ड दिया है वह अस्थायी है। आगे बढ़ने से पहले अपना पासवर्ड बनाइए।", cur: "अभी वाला पासवर्ड (दफ़्तर से मिला)", nw: "नया पासवर्ड (कम से कम 8 अक्षर)", rep: "नया पासवर्ड दोबारा", btn: "पासवर्ड बदलें", out: "साइन आउट" }
    : { title: "Set your own password", lead: "The office issued this password and can see it. Replace it with one only you know before you continue.", cur: "Current password (the one you were given)", nw: "New password (at least 8 characters)", rep: "Repeat new password", btn: "Change password and continue", out: "Sign out" };
  const save = async () => {
    if (f.newPassword.length < 8) return toast(hindi ? "नया पासवर्ड कम से कम 8 अक्षर का हो" : "The new password needs at least 8 characters", "e");
    if (f.newPassword !== f.confirm) return toast(hindi ? "दोनों नए पासवर्ड अलग हैं" : "The two new-password fields do not match", "e");
    setBusy(true);
    try {
      await post("/api/auth/change-password", { currentPassword: f.currentPassword, newPassword: f.newPassword });
      await reloadUser();
      toast(hindi ? "पासवर्ड बदल गया" : "Password changed — you are signed in", "s");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };
  return <div className="login-screen">
    <div className="lg" style={{ padding: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div className="m" style={{ width: 34, height: 34, borderRadius: 7, background: "var(--ac)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14.5 }}>VC</div>
        <div>
          <div style={{ fontSize: 16.5, fontWeight: 700 }} className={hindi ? "hi" : ""}>{t.title}</div>
          <div className="sm">{user.name} · {user.username}</div>
        </div>
      </div>
      <Note k="w" style={{ marginBottom: 14 }}><span className={hindi ? "hi" : ""}>{t.lead}</span></Note>
      <div className="fg">
        <Field label={t.cur} full><input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
        <Field label={t.nw} full><input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
        <Field label={t.rep} full><input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") save(); }} /></Field>
      </div>
      <button className="b b-p" style={{ width: "100%", marginTop: 14 }} disabled={busy || !f.currentPassword || !f.newPassword} onClick={save}>{busy ? "…" : t.btn}</button>
      <button className="b b-g b-s" style={{ width: "100%", marginTop: 8 }} onClick={() => logout().then(() => { window.location.href = "/login"; })}>{t.out}</button>
    </div>
  </div>;
}
