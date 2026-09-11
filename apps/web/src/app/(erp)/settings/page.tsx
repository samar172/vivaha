"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, ROLES, fDT, num, type Role, type Perm } from "@vivaha/shared";
import { useApi, useLines, refresh } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import { useUI, errMsg } from "@/lib/ui";
import { apiFetch, patch, post, put } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { LineChip, Note, Panel, Field, ModalFrame } from "@/components/ui";
import { Icon } from "@/components/icons";

export default function SettingsPage() {
  const [tab, setTab] = useState("lines"); const { data: lines } = useLines(); useFooter(lines?.length ?? 0);
  return <>
    <PageHead crumb={["System", "Settings"]} title="Settings" sub="Business lines, pricing, permissions and masters — all configuration, no deployment" tabs={[{ k: "lines", l: "Business lines", n: lines?.length }, { k: "users", l: "Users & logins" }, { k: "price", l: "Pricing" }, { k: "rbac", l: "Roles & permissions" }, { k: "attrs", l: "Attribute masters" }, { k: "import", l: "Import" }, { k: "backup", l: "Backup & restore" }, { k: "data", l: "Demo data" }]} tab={tab} onTab={setTab} />
    <div className="wa">{tab === "lines" && <LinesTab />}{tab === "users" && <UsersTab />}{tab === "price" && <PriceTab />}{tab === "rbac" && <RbacTab />}{tab === "attrs" && <AttrsTab />}{tab === "import" && <ImportTab />}{tab === "backup" && <BackupTab />}{tab === "data" && <DataTab />}</div>
  </>;
}
// Same financial year the server numbers against: April to March.
const fy = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; };

function LinesTab() {
  const { data: lines } = useLines(); const { toast, openModal } = useUI();
  const upd = async (id: string, name: string, body: Record<string, unknown>) => { try { await patch(`/api/masters/lines/${id}`, body); toast(`${name} updated — bands recalculate live`, "s"); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <><Note style={{ marginBottom: 11 }}>Everything that differs between lines lives here, including the invoice series it bills on. Adding a fifth line is a row in this table, not a code change. A starting number applies only while a series is unused — once an invoice has gone out on it, the number cannot move.</Note>
    <div className="gw"><table className="dg"><thead><tr><th>Line</th><th>Base UOM</th><th>Pack units</th><th className="n">MIN SET QTY</th><th className="n">Hold (min)</th><th>Pricing</th><th>Stock dimensions</th><th>Workflow</th><th>Invoice series</th><th className="n">Starts at</th><th className="n">GST</th><th className="n">Items</th></tr></thead><tbody>
      {lines?.map((l) => <tr key={l.id} style={{ cursor: "default" }}><td><LineChip id={l.id} /> <span className="hi sm">{l.nameHi}</span></td><td className="tab">{l.uom}</td><td className="sm">{l.packUoms.join(", ") || "—"}</td><td className="n"><input type="number" defaultValue={l.minSetQty} onBlur={(e) => Number(e.target.value) !== l.minSetQty && upd(l.id, l.name, { minSetQty: Number(e.target.value) })} style={{ width: 82, height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} /></td><td className="n"><input type="number" defaultValue={l.holdMins} onBlur={(e) => Number(e.target.value) !== l.holdMins && upd(l.id, l.name, { holdMins: Number(e.target.value) })} style={{ width: 64, height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} /></td><td>{({ SLAB: "Quantity slab × multiplier", AREA: "Rate per sq.ft × wastage", QUOTE: "Quotation" } as Record<string, string>)[l.pricingModel]}</td><td className="sm">{l.stockDims.join(", ") || "no stock"}</td><td>{l.workflow === "FULFIL" ? "Book → dispatch" : "Quote → proof → print"}</td><td><input defaultValue={l.invoicePrefix} onBlur={(e) => e.target.value.toUpperCase() !== l.invoicePrefix && upd(l.id, l.name, { invoicePrefix: e.target.value })} style={{ width: 70, height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textTransform: "uppercase" }} /><div className="sm">{l.invoicePrefix}/{fy()}/0001</div></td><td className="n"><input type="number" defaultValue={l.invoiceStart} onBlur={(e) => Number(e.target.value) !== l.invoiceStart && upd(l.id, l.name, { invoiceStart: Number(e.target.value) })} style={{ width: 78, height: 27, border: "1px solid var(--bd)", borderRadius: 5, padding: "0 7px", textAlign: "right" }} /></td><td className="n tab">{l.gstPct}%</td><td className="n tab">{l.itemCount}</td></tr>)}
      <tr style={{ cursor: "default", background: "var(--panel-2)" }}><td colSpan={10} style={{ textAlign: "center" }}><button className="b b-o b-s" onClick={() => openModal(<NewLineModal />)}>+ Add business line</button></td></tr>
    </tbody></table></div></>;
}
function NewLineModal() {
  const { closeModal, toast } = useUI(); const [f, setF] = useState({ code: "", name: "", nameHi: "", icon: "▦", uom: "PCS", packUoms: "", minSetQty: 100, holdMins: 30, gstPct: 18, batchTracked: false, pricingModel: "SLAB", workflow: "FULFIL", facets: "" });
  const go = async () => { try { await post("/api/masters/lines", { ...f, packUoms: f.packUoms.split(",").map((s) => s.trim()).filter(Boolean), facets: f.facets.split(",").map((s) => s.trim()).filter(Boolean) }); toast("Business line added", "s"); closeModal(); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="New business line" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Add line</button></>}><div className="fg"><Field label="Code"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="packaging" /></Field><Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Name (Hindi)"><input className="hi" value={f.nameHi} onChange={(e) => setF({ ...f, nameHi: e.target.value })} /></Field><Field label="Icon"><input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} /></Field><Field label="Base UOM"><input value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value })} /></Field><Field label="Pack units (comma-separated)"><input value={f.packUoms} onChange={(e) => setF({ ...f, packUoms: e.target.value })} /></Field><Field label="MIN SET QTY"><input type="number" value={f.minSetQty} onChange={(e) => setF({ ...f, minSetQty: Number(e.target.value) })} /></Field><Field label="Hold minutes"><input type="number" value={f.holdMins} onChange={(e) => setF({ ...f, holdMins: Number(e.target.value) })} /></Field><Field label="GST %"><input type="number" value={f.gstPct} onChange={(e) => setF({ ...f, gstPct: Number(e.target.value) })} /></Field><Field label="Pricing model"><select value={f.pricingModel} onChange={(e) => setF({ ...f, pricingModel: e.target.value })}><option value="SLAB">Quantity slab</option><option value="AREA">Area</option><option value="QUOTE">Quotation</option></select></Field><Field label="Workflow"><select value={f.workflow} onChange={(e) => setF({ ...f, workflow: e.target.value })}><option value="FULFIL">Book → dispatch</option><option value="JOBWORK">Quote → proof → print</option></select></Field><Field label="Portal facets (comma-separated attribute keys)"><input value={f.facets} onChange={(e) => setF({ ...f, facets: e.target.value })} /></Field><Field label="Batch tracked"><select value={String(f.batchTracked)} onChange={(e) => setF({ ...f, batchTracked: e.target.value === "true" })}><option value="false">No</option><option value="true">Yes (FEFO)</option></select></Field></div></ModalFrame>;
}
interface AppUser { id: string; username: string; name: string; initials: string; role: Role; isActive: boolean; authority: string | null; mustChangePassword: boolean; passwordSetAt: string | null; lastLoginAt: string | null; lockedUntil: string | null; customer: { id: string; name: string; tehsil: string } | null }

function UsersTab() {
  const { data, mutate } = useApi<{ staff: AppUser[]; portal: AppUser[] }>("/api/settings/users");
  const { toast, openModal } = useUI(); const { user: me } = useAuth();
  const reset = async (u: AppUser) => {
    try { const r = await post<{ password: string; username: string }>(`/api/settings/users/${u.id}/reset-password`); mutate(); openModal(<CredentialsModal name={u.name} username={r.username} password={r.password} portal={u.role === "CUSTOMER"} reset />); }
    catch (e) { toast(errMsg(e), "e"); }
  };
  const toggle = async (u: AppUser) => {
    try { await patch(`/api/settings/users/${u.id}`, { isActive: !u.isActive }); toast(`${u.name} ${u.isActive ? "deactivated — they can no longer sign in" : "reactivated"}`, "s"); mutate(); }
    catch (e) { toast(errMsg(e), "e"); }
  };
  const pwState = (u: AppUser) => u.mustChangePassword
    ? <span className="bd b-wa">Temporary — not changed yet</span>
    : u.passwordSetAt ? <span className="bd b-ok">Set by holder</span> : <span className="bd b-nu">Original</span>;
  const table = (rows: AppUser[] | undefined, portal: boolean) => <div className="gw"><table className="dg"><thead><tr>
    <th>{portal ? "Firm" : "Person"}</th><th>Username</th><th>{portal ? "Contact" : "Role"}</th><th>Password</th><th>Last sign-in</th><th>Status</th><th></th>
  </tr></thead><tbody>
    {rows?.length ? rows.map((u) => <tr key={u.id} style={{ cursor: "default" }}>
      <td className="w">{portal ? u.customer?.name ?? "—" : u.name}<div className="sm">{portal ? u.customer?.tehsil : u.initials}</div></td>
      <td><span className="rid">{u.username}</span>{me?.id === u.id && <span className="sm"> · you</span>}</td>
      <td>{portal ? <>{u.name}<div className="sm">{u.authority}</div></> : ROLE_LABELS[u.role]}</td>
      <td>{pwState(u)}</td>
      <td className="sm">{u.lastLoginAt ? fDT(u.lastLoginAt) : "never"}</td>
      <td>{u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <span className="bd b-er">Locked</span> : u.isActive ? <span className="bd b-ok">Active</span> : <span className="bd b-nu">Inactive</span>}</td>
      <td><button className="b b-o b-s" onClick={() => reset(u)}>Reset password</button> <button className="b b-g b-s" disabled={me?.id === u.id} onClick={() => toggle(u)}>{u.isActive ? "Deactivate" : "Activate"}</button></td>
    </tr>) : <tr><td colSpan={7}><Note style={{ margin: 9 }}>No {portal ? "portal logins" : "staff accounts"} yet.</Note></td></tr>}
    <tr style={{ cursor: "default", background: "var(--panel-2)" }}><td colSpan={7} style={{ textAlign: "center" }}>
      <button className="b b-o b-s" onClick={() => openModal(<NewUserModal portal={portal} onDone={mutate} />)}>+ {portal ? "Issue a portal login" : "Add an employee"}</button>
    </td></tr>
  </tbody></table></div>;
  return <>
    <Note style={{ marginBottom: 11 }}>Every account is created with a temporary password that the office can see once. The holder is forced to replace it the first time they sign in, and after that nobody in the office can read it — a reset issues a fresh temporary one and is written to the audit log.</Note>
    <Panel t="Staff accounts" h={`${data?.staff.length ?? 0} accounts`}>{table(data?.staff, false)}</Panel>
    <Panel t="Customer portal logins" h={`${data?.portal.length ?? 0} logins`}>{table(data?.portal, true)}</Panel>
  </>;
}

function NewUserModal({ portal, onDone }: { portal: boolean; onDone: () => void }) {
  const { closeModal, toast, openModal } = useUI();
  const { data: custs } = useApi<{ id: string; name: string; tehsil: string; contactName: string }[]>(portal ? "/api/customers" : null);
  const [f, setF] = useState({ name: "", username: "", role: portal ? "CUSTOMER" : "SALES_EXECUTIVE", customerId: "", authority: "Owner" });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const body = portal
        ? { name: f.name, username: f.username, role: "CUSTOMER", customerId: f.customerId || custs?.[0]?.id, authority: f.authority }
        : { name: f.name, username: f.username, role: f.role };
      const r = await post<{ password: string; user: AppUser }>("/api/settings/users", body);
      onDone(); closeModal();
      openModal(<CredentialsModal name={f.name} username={r.user.username} password={r.password} portal={portal} />);
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };
  const suggest = (n: string) => n.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, ".").slice(0, 24);
  return <ModalFrame title={portal ? "Issue a portal login" : "Add an employee"} onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={busy || !f.name || !f.username} onClick={go}>{busy ? "…" : "Create and show password"}</button></>}>
    <div className="fg">
      {portal && <Field label="Firm" full><select value={f.customerId || custs?.[0]?.id || ""} onChange={(e) => setF({ ...f, customerId: e.target.value })}>{custs?.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.tehsil}</option>)}</select></Field>}
      <Field label={portal ? "Contact name" : "Full name"} full><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, username: f.username || suggest(e.target.value) })} placeholder={portal ? "Vikram Sharma" : "Khadija Ansari"} /></Field>
      <Field label="Username" full><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} placeholder={portal ? "sharma_wedding" : "khadija.sales"} /></Field>
      {portal
        ? <Field label="Authority"><select value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })}><option value="Owner">Owner — can book and pay</option><option value="Staff">Staff — can book only</option></select></Field>
        : <Field label="Role" full><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.filter((r) => r !== "CUSTOMER").map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>}
    </div>
    <Note k="w" style={{ marginTop: 12 }}>{portal ? "The firm signs in on the Customer tab of the login screen." : "The employee signs in on the Internal (Office) tab. What they can see comes from the role — edit it under Roles & permissions."}</Note>
  </ModalFrame>;
}

function CredentialsModal({ name, username, password, portal, reset }: { name: string; username: string; password: string; portal: boolean; reset?: boolean }) {
  const { closeModal, toast } = useUI();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = `${origin}/login`;
  const message = `Vivaha Cards — ${portal ? "customer portal" : "office"} sign-in\n${link}\nUsername: ${username}\nTemporary password: ${password}\n\nYou will be asked to set your own password the first time you sign in.`;
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`, "s"); } catch { toast("Could not reach the clipboard — select and copy by hand", "e"); } };
  return <ModalFrame title={reset ? `New password for ${name}` : `${name} is set up`} onClose={closeModal} actions={<><button className="b b-o" onClick={() => copy(message, "Sign-in details")}>Copy message</button><button className="b b-p" onClick={closeModal}>Done</button></>}>
    <Note k="w" style={{ marginBottom: 13 }}>This password is shown once. Close this box and it cannot be read again — you would have to issue another reset.</Note>
    <div className="fg">
      <Field label="Sign-in link" full><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} /></Field>
      <Field label="Username" full><input readOnly value={username} onFocus={(e) => e.currentTarget.select()} /></Field>
      <Field label="Temporary password" full><input readOnly value={password} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: "var(--mono)", fontSize: 16.5, fontWeight: 700, letterSpacing: ".06em" }} /></Field>
    </div>
    <div style={{ display: "flex", gap: 7, marginTop: 11 }}>
      <button className="b b-o b-s" onClick={() => copy(password, "Password")}>Copy password</button>
      <button className="b b-o b-s" onClick={() => copy(link, "Link")}>Copy link</button>
    </div>
    <Note style={{ marginTop: 12 }}>{portal ? "Send this on WhatsApp to the firm's contact. They sign in on the Customer tab." : "Hand this to the employee. They sign in on the Internal (Office) tab."} The first sign-in will not let them do anything until they have replaced this password.</Note>
  </ModalFrame>;
}

function PriceTab() {
  const { data: groups } = useApi<{ name: string; multiplier: number }[]>("/api/masters/pricing-groups"); const { data: s, mutate } = useApi<{ minMargin: number }>("/api/settings"); const { toast } = useUI(); const { can } = useAuth();
  const save = async (name: string, v: number) => { try { await put(`/api/masters/pricing-groups/${name}`, { multiplier: v }); toast(`${name} multiplier updated — future orders only`, "s"); refresh("/api/"); } catch (e) { toast(errMsg(e), "e"); } };
  return <div className="g2"><Panel t="Customer group multipliers" h="slab rate × multiplier"><div className="pnb"><div className="fg">{groups?.map((g) => <Field key={g.name} label={g.name}><input type="number" step="0.01" defaultValue={g.multiplier} onBlur={(e) => Number(e.target.value) !== g.multiplier && save(g.name, Number(e.target.value))} /></Field>)}</div><Note k="w" style={{ marginTop: 11 }}>Historical orders keep their price snapshot and never recalculate.</Note></div></Panel>
    <Panel t="Margin floor" h="the guard that stops silent under-pricing"><div className="pnb"><Field label="Minimum gross margin over landed cost (%)"><input type="number" defaultValue={(s?.minMargin ?? .18) * 100} disabled={!can("settings.manage")} onBlur={async (e) => { const v = Number(e.target.value) / 100; if (v !== s?.minMargin) { try { await put("/api/settings", { minMargin: v }); toast("Margin floor updated", "s"); mutate(); } catch (er) { toast(errMsg(er), "e"); } } }} /></Field><Note style={{ marginTop: 9 }}>A deep quantity slab stacked on a distributor multiplier can price below cost. The floor blocks the line and asks for an authorised override with a reason.</Note><div style={{ marginTop: 11 }}><div className="sm" style={{ marginBottom: 6, fontFamily: "inherit" }}>Worked example — a 6,000 pc distributor order</div><table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Step</th><th className="n">Value</th></tr></thead><tbody>{[["Deepest slab rate", "₹36"], ["Distributor multiplier", "×1.12"], ["Computed rate", "₹40"], ["Landed cost", "₹35"], [`Floor at ${(s?.minMargin ?? .18) * 100}%`, "₹41"], ["Result", <span className="bd b-er" key="r">Blocked</span>]].map((r, i) => <tr key={i} style={{ cursor: "default" }}><td>{r[0]}</td><td className="n tab">{r[1]}</td></tr>)}</tbody></table></div></div></Panel></div>;
}
function RbacTab() {
  const { data, mutate } = useApi<{ perms: Perm[]; roles: Role[]; matrix: Record<string, string[]> }>("/api/settings/permissions"); const { toast } = useUI(); const { can } = useAuth();
  if (!data) return null;
  const toggle = async (role: Role, p: string) => { const cur = data.matrix[role] ?? []; const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]; try { await put(`/api/settings/permissions/${role}`, { perms: next }); mutate(); toast(`${ROLE_LABELS[role]}: ${p} ${cur.includes(p) ? "removed" : "granted"} — takes effect on next sign-in`, "s"); } catch (e) { toast(errMsg(e), "e"); } };
  return <><Note style={{ marginBottom: 11 }}>Permissions are stored as data, not compiled into the interface. The navigation and every action button render from the signed-in role&apos;s permission set — sign in as another role to see it change.{can("settings.manage") && " Click a cell to toggle."}</Note>
    <div className="gw"><table className="dg"><thead><tr><th style={{ position: "sticky", left: 0, background: "var(--panel-2)", zIndex: 3 }}>Capability</th>{data.roles.map((r) => <th className="n" key={r}>{ROLE_LABELS[r]}</th>)}</tr></thead><tbody>{data.perms.map((p) => <tr key={p} style={{ cursor: "default" }}><td className="sm" style={{ position: "sticky", left: 0, background: "#fff", fontFamily: "var(--mono)" }}>{p}</td>{data.roles.map((r) => <td className="n" key={r} onClick={() => can("settings.manage") && toggle(r, p)} style={{ cursor: can("settings.manage") ? "pointer" : "default" }}>{data.matrix[r]?.includes(p) ? <span style={{ color: "var(--ok)", fontWeight: 700 }}><Icon n="check" s={13} style={{ display: "inline", verticalAlign: "-2px" }} /></span> : <span style={{ color: "var(--t4)" }}><Icon n="x" s={13} style={{ display: "inline", verticalAlign: "-2px" }} /></span>}</td>)}</tr>)}</tbody></table></div></>;
}
function AttrsTab() {
  const { data, mutate } = useApi<{ id: string; lineId: string | null; key: string; label: string; values: string[]; multiSelect: boolean; portalFacet: boolean }[]>("/api/masters/attributes"); const { toast, openModal } = useUI();
  const manage = (a: NonNullable<typeof data>[0]) => { const v = prompt(`${a.label} — values (comma-separated)`, a.values.join(", ")); if (v == null) return; patch(`/api/masters/attributes/${a.id}`, { values: v.split(",").map((s) => s.trim()).filter(Boolean) }).then(() => { toast(`${a.label} updated`, "s"); mutate(); }).catch((e) => toast(errMsg(e), "e")); };
  return <><Note style={{ marginBottom: 11 }}>The client wrote <b>&quot;or any other&quot;</b> and <b>&quot;future option to add more fields&quot;</b> twice. That is this screen: every classification is an admin-editable master, so a new community, machine type or material never needs a developer.</Note>
    <div className="gw"><table className="dg"><thead><tr><th>Attribute</th><th>Line</th><th>Type</th><th>Values</th><th>Multi-select</th><th>Portal facet</th><th></th></tr></thead><tbody>{data?.map((a) => <tr key={a.id} style={{ cursor: "default" }}><td style={{ color: "var(--t9)", fontWeight: 500 }}>{a.label}</td><td>{a.lineId ? <LineChip id={a.lineId} /> : <span className="bd b-nu">Customer</span>}</td><td className="sm">list</td><td className="w" style={{ whiteSpace: "normal" }}>{a.values.length > 8 ? a.values.length + " values" : a.values.join(", ")}</td><td>{a.multiSelect ? "Yes" : "No"}</td><td>{a.portalFacet ? "Yes" : "No"}</td><td><button className="b b-o b-s" onClick={() => manage(a)}>Manage</button></td></tr>)}<tr style={{ cursor: "default", background: "var(--panel-2)" }}><td colSpan={7} style={{ textAlign: "center" }}><button className="b b-o b-s" onClick={() => openModal(<NewAttrModal />)}>+ Add attribute</button></td></tr></tbody></table></div></>;
}
function NewAttrModal() {
  const { closeModal, toast } = useUI(); const { data: lines } = useLines(); const [f, setF] = useState({ lineId: "", key: "", label: "", values: "", multiSelect: false, portalFacet: true });
  const go = async () => { try { await post("/api/masters/attributes", { ...f, lineId: f.lineId || null, values: f.values.split(",").map((s) => s.trim()).filter(Boolean) }); toast("Attribute added", "s"); closeModal(); refresh("/api/masters/attributes"); } catch (e) { toast(errMsg(e), "e"); } };
  return <ModalFrame title="New attribute" onClose={closeModal} actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" onClick={go}>Add</button></>}><div className="fg"><Field label="Line"><select value={f.lineId} onChange={(e) => setF({ ...f, lineId: e.target.value })}><option value="">Customer-level</option>{lines?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><Field label="Key"><input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="finish" /></Field><Field label="Label"><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field><Field label="Values (comma-separated)" full><input value={f.values} onChange={(e) => setF({ ...f, values: e.target.value })} /></Field><Field label="Multi-select"><select value={String(f.multiSelect)} onChange={(e) => setF({ ...f, multiSelect: e.target.value === "true" })}><option value="false">No</option><option value="true">Yes</option></select></Field><Field label="Portal facet"><select value={String(f.portalFacet)} onChange={(e) => setF({ ...f, portalFacet: e.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></Field></div></ModalFrame>;
}
function ImportTab() {
  const { toast } = useUI();
  return <Panel t="Excel / CSV import" h="items, customers, opening stock, opening balances"><div className="pnb"><div className="stp">{["Upload", "Map columns", "Validate"].map((s, i) => <span key={s} style={{ display: "contents" }}><div className="s dn"><div className="d"><Icon n="check" s={11} /></div>{s}</div><div className="ln" /></span>)}<div className="s ac"><div className="d">4</div>Preview</div><div className="ln" /><div className="s"><div className="d">5</div>Commit</div></div>
    <div className="g2"><div><div className="sm" style={{ marginBottom: 7, fontFamily: "inherit" }}>customers_migration.xlsx · 216 rows · validated</div><table className="dg" style={{ fontSize: 13 }}><thead><tr><th>Row</th><th>Firm</th><th>GSTIN</th><th>Opening</th><th>Status</th></tr></thead><tbody>{[["1", "Marwar Shaadi Bazaar", "08ABKCM4471P1ZD", "₹96,000", <span className="bd b-ok" key="a">OK</span>], ["2", "Kalinga Card House", "08ABLCK2210R1ZF", "₹0", <span className="bd b-ok" key="b">OK</span>], ["3", "Suryodaya Cards Jodhpur", "08ABMCS8830T1ZH", "₹1,42,000", <span className="bd b-ok" key="c">OK</span>], ["4", "Nokha Card Centre", "—", "₹18,400", <span className="bd b-wa" key="d">GSTIN missing</span>], ["5", "Churu Card Traders", "08ABQCC1140V1ZL", "₹—", <span className="bd b-er" key="e">Opening not a number</span>]].map((r, i) => <tr key={i} style={{ cursor: "default" }}>{r.map((c, j) => <td key={j} className={j === 3 ? "n tab" : ""}>{c}</td>)}</tr>)}</tbody></table></div>
      <div><Note k="o" style={{ marginBottom: 9 }}><b>214 rows ready.</b> 1 warning, 1 error. Errors block only their own row — the rest commit.</Note><Note k="w">Opening balances must reconcile to the client&apos;s register before Phase 1 sign-off. Run one month in parallel and review the variance weekly.</Note><button className="b b-p" style={{ marginTop: 11 }} onClick={() => toast("Import service: 214 rows would commit · 2 rows to the error report", "i")}>Commit 214 rows</button></div></div></div></Panel>;
}
interface Manifest { app: string; format: number; takenAt: string; through: string | null; takenBy?: string; company?: string; rows?: number; counts?: Record<string, number> }
interface BackupFile { manifest: Manifest; data: Record<string, unknown[]> }

function BackupTab() {
  const { toast } = useUI(); const { logout } = useAuth(); const router = useRouter();
  const { data: state, mutate: mutState } = useApi<{ format: number; through: string | null }>("/api/settings/backup/state");
  const [busy, setBusy] = useState<"" | "down" | "up">("");
  const [file, setFile] = useState<BackupFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [allowOlder, setAllowOlder] = useState(false);

  const download = async () => {
    setBusy("down");
    try {
      const b = await apiFetch<BackupFile>("/api/settings/backup");
      // Second-precision stamp: two backups can never land on the same name.
      const stamp = new Date(b.manifest.takenAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const blob = new Blob([JSON.stringify(b, null, 1)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `vivaha-backup-${stamp}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast(`Backup saved — ${num(b.manifest.rows ?? 0)} records`, "s");
      mutState();
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(""); }
  };

  const pick = async (f: File | null) => {
    setFile(null); setFileName(""); setConfirm(""); setAllowOlder(false);
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as BackupFile;
      if (parsed?.manifest?.app !== "vivaha-erp") return toast("That file was not produced by this system", "e");
      setFile(parsed); setFileName(f.name);
    } catch { toast("That file is not readable JSON", "e"); }
  };

  const older = !!(file?.manifest.through && state?.through && new Date(file.manifest.through) < new Date(state.through));
  const restore = async () => {
    if (!file) return;
    if (confirm !== "RESTORE") return toast("Type RESTORE to confirm", "e");
    setBusy("up");
    try {
      const r = await post<{ inserted: Record<string, number>; skipped: string[]; signOutRequired: boolean }>("/api/settings/restore", { manifest: file.manifest, data: file.data, confirm: "RESTORE", allowOlder });
      const total = Object.values(r.inserted).reduce((s, n) => s + n, 0);
      toast(`Restored ${num(total)} records`, "s");
      setFile(null); setFileName(""); setConfirm("");
      if (r.signOutRequired) { toast("Your account is not in that backup — signing out", "w"); setTimeout(() => logout().then(() => router.replace("/login")), 1200); return; }
      refresh("/api/"); mutState();
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(""); }
  };

  const when = (iso: string | null | undefined) => iso ? fDT(iso) : "—";
  return <div className="g2">
    <Panel t="Download a backup" h="everything, up to this moment">
      <div className="pnb">
        <Note style={{ marginBottom: 12 }}>One file holds every table — items, stock, orders, invoices, the ledger, users and the audit trail. It is a point-in-time copy, not an incremental one, so each download stands on its own.</Note>
        <div className="df"><span className="k">Live data reaches</span><span className="v m">{when(state?.through)}</span></div>
        <div className="df"><span className="k">Backup format</span><span className="v m">v{state?.format ?? "—"}</span></div>
        <button className="b b-p" style={{ marginTop: 13 }} disabled={busy === "down"} onClick={download}>{busy === "down" ? "Preparing…" : "Download backup"}</button>
        <Note k="i" style={{ marginTop: 12 }}>The file is named <b>vivaha-backup-YYYY-MM-DDTHH-MM-SS.json</b> — stamped to the second, so backups never overwrite one another and sort in order on disk.</Note>
      </div>
    </Panel>

    <Panel t="Restore from a backup" h="replaces everything">
      <div className="pnb">
        <Note k="w" style={{ marginBottom: 12 }}>Restoring <b>replaces every record in the live database</b> with the contents of the file. Anything entered since that backup was taken is gone. Take a fresh backup first.</Note>
        <Field label="Backup file" full>
          <input type="file" accept="application/json,.json" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </Field>

        {file && <div style={{ marginTop: 12, border: "1px solid var(--bd)", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{fileName}</div>
          <div className="df"><span className="k">Taken</span><span className="v m">{when(file.manifest.takenAt)}</span></div>
          <div className="df"><span className="k">Data reaches</span><span className="v m">{when(file.manifest.through)}</span></div>
          <div className="df"><span className="k">Taken by</span><span className="v">{file.manifest.takenBy ?? "—"}</span></div>
          <div className="df"><span className="k">Records</span><span className="v m">{num(file.manifest.rows ?? 0)}</span></div>

          {older
            ? <Note k="w" style={{ marginTop: 11 }}>
                This backup reaches <b>{when(file.manifest.through)}</b>, but the live data runs to <b>{when(state?.through)}</b>. Restoring it rolls the business back and drops everything in between.
                <label style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 9, fontWeight: 600 }}>
                  <input type="checkbox" checked={allowOlder} onChange={(e) => setAllowOlder(e.target.checked)} /> I know this is an older snapshot — restore it anyway
                </label>
              </Note>
            : <Note k="o" style={{ marginTop: 11 }}>This backup is at or ahead of the live data — nothing newer will be lost.</Note>}

          <Field label='Type RESTORE to confirm' full><input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESTORE" /></Field>
          <button className="b b-d" style={{ marginTop: 11 }} disabled={busy === "up" || confirm !== "RESTORE" || (older && !allowOlder)} onClick={restore}>
            {busy === "up" ? "Restoring…" : "Replace the database with this backup"}
          </button>
        </div>}
      </div>
    </Panel>
  </div>;
}

function DataTab() {
  const { data } = useApi<Record<string, number>>("/api/settings/counts"); const { toast } = useUI(); const router = useRouter(); void router;
  return <div className="g2"><Panel t="Demo data"><div className="pnb">{data && [["Items", data.items], ["Firms", data.firms], ["Orders", data.orders], ["Invoices", data.invoices], ["Stock rows", data.stockRows], ["Inventory transactions", data.txns], ["Audit entries", data.audit]].map(([k, v]) => <div className="df" key={String(k)}><span className="k">{k}</span><span className="v m">{v}</span></div>)}<button className="b b-d" style={{ marginTop: 13 }} onClick={() => toast("Run `npm run db:seed` in apps/api to reset the database to the demo seed", "i")}>Reset demo to seed</button><Note k="w" style={{ marginTop: 11 }}>This is a live database. Resetting re-runs the seed script and wipes every transaction.</Note></div></Panel>
    <Panel t="What this build demonstrates"><div className="pnb">{["Real-time availability across five buckets, never a day-start snapshot", "Display bands that protect stock depth from competitors", "Quantity slabs × group multiplier, with a margin floor that blocks under-pricing", "Dual credit gate — amount or ageing, whichever breaches first", "Booking holds that lapse to Lapsed, not Cancelled, with an alert", "Partial dispatch billing only what shipped, with a live backorder", "GST tax invoice with mixed rate blocks and correct CGST/SGST split", "Ledger as the only source of truth for outstanding", "Returns that re-enter stock only on an inspection outcome", "Four business lines on one engine with a tab toggle", "Alternate item ranking and split fulfilment in the portal", "Kit correction with four buckets, ending in a replenishment cart"].map((t) => <div key={t} style={{ display: "flex", gap: 8, padding: "4px 0", fontSize: 13.5 }}><span style={{ color: "var(--ok)" }}><Icon n="check" s={12} style={{ display: "inline", verticalAlign: "-2px" }} /></span><span>{t}</span></div>)}</div></Panel></div>;
}
