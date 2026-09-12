"use client";
import { useState } from "react";
import { useApi, refresh } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { post, patch, del } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { Sect } from "@/components/portal/Bits";

// The firm's own people, run by the firm.
//
// A retailer who takes on a nephew to mind the counter should not have to ring
// Bikaner to get him a login, and the office should not have to remember which
// number that firm wants its bills on. Both are facts the firm knows first.
//
// Only the owner sees this. A staff login gets the note and nothing else — not
// because the list is secret, but because a page full of buttons that all
// refuse is worse than a page that says who can use them.

interface Contact {
  id: string; name: string; role: string; phone: string; authority: string; billsTo: boolean;
  hasLogin: boolean; userId: string | null;
  user: { id: string; username: string; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null; lockedUntil: string | null } | null;
}
interface StaffState { canManage: boolean; limit: number; me: { id: string; username: string }; contacts: Contact[] }
interface Issued { username: string; password: string }

// The role is stored in English whichever language it was picked in — the
// office reads this list too, and a firm switching language should not change
// what its own records say.
const ROLES: [string, string][] = [["Manager", "मैनेजर"], ["Accounts", "अकाउंट्स"], ["Counter", "काउंटर"], ["Godown", "गोदाम"], ["Driver", "ड्राइवर"], ["Staff", "स्टाफ़"]];

export default function StaffPage() {
  const { data, mutate } = useApi<StaffState>("/api/portal/staff");
  const { lang, t } = useLang(); const { toast } = useUI(); const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const hi = lang === "hi";

  if (!data) return null;
  const { contacts, canManage, limit } = data;

  const reload = () => { mutate(); refresh("/api/portal"); };

  const issue = async (c: Contact) => {
    try {
      const r = await post<{ login: Issued }>(`/api/portal/staff/${c.id}/login`, {});
      setIssued(r.login); reload();
    } catch (e) { toast(errMsg(e), "e"); }
  };
  const toggleLogin = async (c: Contact) => {
    try { await post(`/api/portal/staff/${c.id}/login/disable`, {}); reload(); toast(c.user?.isActive ? t("loginOff") : t("loginOn"), "s"); }
    catch (e) { toast(errMsg(e), "e"); }
  };
  const setBills = async (c: Contact, billsTo: boolean) => {
    try { await patch(`/api/portal/staff/${c.id}`, { billsTo }); reload(); }
    catch (e) { toast(errMsg(e), "e"); }
  };
  const remove = async (c: Contact) => {
    if (!window.confirm(t("removeSure"))) return;
    try { await del(`/api/portal/staff/${c.id}`); reload(); toast(hi ? `${c.name} हटा दिए गए` : `${c.name} removed`, "s"); }
    catch (e) { toast(errMsg(e), "e"); }
  };

  return <>
    <Sect t={t("staffAndLogins")} />
    <div className="blk">
      <div className={"sm" + (hi ? " hi" : "")}>{t("billsNote")}</div>
      {!canManage && <div className={"note w" + (hi ? " hi" : "")} style={{ marginTop: 9 }}>{t("ownerOnlyNote")}</div>}
    </div>

    {contacts.map((c) => {
      const isMe = c.userId === user?.id;
      const on = c.user?.isActive !== false;
      return <div className="blk" key={c.id}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name} {c.authority === "Owner" && <span className="bd b-nu" style={{ marginLeft: 4 }}>{t("owner")}</span>}</div>
            <div className="sm">{c.role} · <span className="tab">{c.phone}</span></div>
            <div className="sm" style={{ marginTop: 4 }}>
              {c.user
                ? <span className={"bd " + (on ? "b-ok" : "b-nu")}>{on ? t("loginOn") : t("loginOff")} · <span className="tab">{c.user.username}</span></span>
                : <span className="bd b-nu">{t("noLogin")}</span>}
            </div>
          </div>
          {c.billsTo && <span className="bd b-ok" title={t("billsHere")}>₹</span>}
        </div>

        {canManage && <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 11, alignItems: "center" }}>
          <label className={"sm" + (hi ? " hi" : "")} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={c.billsTo} onChange={(e) => setBills(c, e.target.checked)} /> {t("billsHere")}
          </label>
          <span style={{ flexBasis: "100%" }} />
          <button className={"b b-o b-s" + (hi ? " hi" : "")} onClick={() => issue(c)}>{c.user ? t("newPassword") : t("createLogin")}</button>
          {c.user && !isMe && <button className={"b b-o b-s" + (hi ? " hi" : "")} onClick={() => toggleLogin(c)}>{on ? t("disableLogin") : t("enableLogin")}</button>}
          {c.authority !== "Owner" && !isMe && <button className={"b b-g b-s" + (hi ? " hi" : "")} onClick={() => remove(c)}>{t("removePerson")}</button>}
        </div>}
      </div>;
    })}

    {canManage && (adding
      ? <AddForm limit={limit} count={contacts.length} onDone={(login) => { setAdding(false); if (login) setIssued(login); reload(); }} onCancel={() => setAdding(false)} />
      : <button className={"b b-p b-f" + (hi ? " hi" : "")} disabled={contacts.length >= limit} onClick={() => setAdding(true)}>+ {t("addPerson")}</button>)}

    {canManage && contacts.length >= limit && <div className={"sm" + (hi ? " hi" : "")} style={{ marginTop: 8 }}>
      {hi ? `सूची में ${limit} लोग पूरे हो गए।` : `The list is full at ${limit}.`}
    </div>}

    {issued && <PasswordCard issued={issued} onClose={() => setIssued(null)} />}
  </>;
}

function AddForm({ limit, count, onDone, onCancel }: { limit: number; count: number; onDone: (login: Issued | null) => void; onCancel: () => void }) {
  const { lang, t } = useLang(); const { toast } = useUI();
  const hi = lang === "hi";
  const [f, setF] = useState({ name: "", role: ROLES[0][0], phone: "", billsTo: false, withLogin: true });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ login: Issued | null }>("/api/portal/staff", { ...f, role: f.role || "Staff" });
      toast(hi ? `${f.name} जोड़ दिए गए` : `${f.name} added`, "s");
      onDone(r.login);
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <div className="blk">
    <div className="lb">{t("addPerson")} <span style={{ float: "right", fontWeight: 600 }}>{count}/{limit}</span></div>
    <input className="scani" placeholder={t("personName")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
    <select className="scani" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map(([en, rhi]) => <option key={en} value={en}>{hi ? rhi : en}</option>)}</select>
    <input className="scani tab" placeholder="98290 00000" inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
    <label className={"sm" + (hi ? " hi" : "")} style={{ display: "flex", alignItems: "center", gap: 7, margin: "9px 0" }}>
      <input type="checkbox" checked={f.billsTo} onChange={(e) => setF({ ...f, billsTo: e.target.checked })} /> {t("billsHere")}
    </label>
    <label className={"sm" + (hi ? " hi" : "")} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 11 }}>
      <input type="checkbox" checked={f.withLogin} onChange={(e) => setF({ ...f, withLogin: e.target.checked })} /> {t("giveLogin")}
    </label>
    <div style={{ display: "flex", gap: 8 }}>
      <button className={"b b-o" + (hi ? " hi" : "")} style={{ flex: 1 }} onClick={onCancel}>{t("cancel")}</button>
      <button className={"b b-p" + (hi ? " hi" : "")} style={{ flex: 2 }} disabled={busy || f.name.trim().length < 2 || f.phone.replace(/\D/g, "").length < 10} onClick={save}>{t("save")}</button>
    </div>
  </div>;
}

// The password is returned once and never again. It is shown large enough to
// read off a phone held at arm's length and copied with one tap, because the
// next thing that happens is somebody reading it out over a counter.
function PasswordCard({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const { lang, t } = useLang(); const { toast } = useUI();
  const hi = lang === "hi";
  const copy = () => {
    navigator.clipboard?.writeText(`${issued.username} / ${issued.password}`)
      .then(() => toast(t("copied"), "s"))
      .catch(() => { /* clipboard blocked — the text is on screen anyway */ });
  };
  return <div className="pwov" onClick={onClose}>
    <div className="pwcd" onClick={(e) => e.stopPropagation()}>
      <div className={"lb" + (hi ? " hi" : "")}>{t("passwordOnce")}</div>
      <div className="tot"><span className={hi ? "hi" : ""}>{t("username")}</span><span className="tab" style={{ fontWeight: 700 }}>{issued.username}</span></div>
      <div className="tot"><span className={hi ? "hi" : ""}>{t("password")}</span><span className="tab" style={{ fontWeight: 700, fontSize: 18, letterSpacing: ".04em" }}>{issued.password}</span></div>
      <div className={"sm" + (hi ? " hi" : "")} style={{ marginTop: 8 }}>{t("mustChange")}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className={"b b-o" + (hi ? " hi" : "")} style={{ flex: 1 }} onClick={copy}>{hi ? "कॉपी करें" : "Copy"}</button>
        <button className={"b b-p" + (hi ? " hi" : "")} style={{ flex: 1 }} onClick={onClose}>{t("done")}</button>
      </div>
    </div>
  </div>;
}
