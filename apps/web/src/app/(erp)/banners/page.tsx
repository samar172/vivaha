"use client";
import { useRef, useState } from "react";
import { num, fDate } from "@vivaha/shared";
import { useApi, useLines, refresh } from "@/lib/hooks";
import { useUI, errMsg } from "@/lib/ui";
import { post, patch, del } from "@/lib/api";
import { PageHead } from "@/components/PageHead";
import { useFooter } from "@/components/Shell";
import { KPI, LineChip, Empty, Note, Field, ModalFrame } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { ItemView } from "@/components/types";

interface Ad {
  id: string; title: string; sub: string; imageUrl: string | null;
  lineId: string | null; line: { id: string; name: string } | null;
  itemId: string | null; item: { id: string; sku: string; name: string } | null;
  startsAt: string | null; endsAt: string | null;
  isActive: boolean; sortOrder: number; impressions: number; taps: number;
}

// What firms see above the catalogue in the portal. The Ad row and the portal
// slot have both existed since the first build — they were seeded-only and
// text-only. This is the screen that was missing, plus the picture.
export default function BannersPage() {
  const { data, mutate } = useApi<Ad[]>("/api/masters/ads");
  const { openModal, toast } = useUI();
  const rows = data ?? [];
  useFooter(rows.length);

  const live = rows.filter((a) => a.isActive);
  const shown = rows.reduce((s, a) => s + a.impressions, 0);
  const tapped = rows.reduce((s, a) => s + a.taps, 0);

  const toggle = async (a: Ad) => {
    try { await patch(`/api/masters/ads/${a.id}`, { isActive: !a.isActive }); toast(a.isActive ? "Taken down" : "Live in the portal", "s"); mutate(); }
    catch (e) { toast(errMsg(e), "e"); }
  };
  const remove = async (a: Ad) => {
    try { await del(`/api/masters/ads/${a.id}`); toast("Banner removed", "s"); mutate(); }
    catch (e) { toast(errMsg(e), "e"); }
  };

  return <>
    <PageHead
      crumb={["System", "Banners"]}
      title="Banners"
      sub="What firms see above the catalogue when they open the portal. A picture, a line of text, and who it is for."
      actions={<button className="b b-p" onClick={() => openModal(<BannerForm onSaved={mutate} />, "w")}>+ New banner</button>}
    />
    <div className="wa">
      <div className="kpis">
        <KPI l="Banners" v={num(rows.length)} d={`${live.length} live`} />
        <KPI l="Times shown" v={num(shown)} />
        <KPI l="Taps" v={num(tapped)} d={shown ? `${((tapped / shown) * 100).toFixed(1)}% of views` : "nothing shown yet"} />
        <KPI l="With a picture" v={num(rows.filter((a) => a.imageUrl).length)} d="a picture is what sells a card" />
      </div>

      {rows.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 13 }}>
        {rows.map((a) => <div key={a.id} className="pn" style={{ margin: 0, opacity: a.isActive ? 1 : .55 }}>
          {a.imageUrl
            ? <img src={a.imageUrl} alt={a.title} style={{ width: "100%", aspectRatio: "16/6", objectFit: "cover", display: "block", borderRadius: "5px 5px 0 0" }} />
            : <div style={{ aspectRatio: "16/6", background: "linear-gradient(100deg,#2E1020,#5C1636)", borderRadius: "5px 5px 0 0", display: "grid", placeItems: "center", color: "rgba(255,255,255,.6)", fontSize: 13 }}>No picture — shows as a text banner</div>}
          <div className="pnb">
            <div style={{ fontSize: 15, fontWeight: 700 }}>{a.title}</div>
            {a.sub && <div className="sm" style={{ marginTop: 2 }}>{a.sub}</div>}
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
              {a.isActive ? <span className="bd b-ok">Live</span> : <span className="bd b-nu">Off</span>}
              {a.lineId ? <LineChip id={a.lineId} /> : <span className="bd b-nu">All lines</span>}
              {a.item && <span className="bd b-nu">opens {a.item.sku}</span>}
            </div>
            {(a.startsAt || a.endsAt) && <div className="sm" style={{ marginTop: 6 }}>
              {a.startsAt ? `from ${fDate(a.startsAt)}` : "from now"} · {a.endsAt ? `until ${fDate(a.endsAt)}` : "no end date"}
            </div>}
            <div className="sm" style={{ marginTop: 6 }}>shown {num(a.impressions)} · tapped {num(a.taps)}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button className="b b-o b-s" onClick={() => openModal(<BannerForm ad={a} onSaved={mutate} />, "w")}>Edit</button>
              <button className="b b-o b-s" onClick={() => toggle(a)}>{a.isActive ? "Take down" : "Put live"}</button>
              <button className="b b-g b-s" style={{ marginLeft: "auto" }} onClick={() => remove(a)}><Icon n="x" s={11} /></button>
            </div>
          </div>
        </div>)}
      </div> : <Empty t="No banners yet" d="A banner is the first thing a firm sees when it opens the portal. Put this season's range on one." action={<button className="b b-p" onClick={() => openModal(<BannerForm onSaved={mutate} />, "w")}>+ New banner</button>} />}

      <Note k="i" style={{ marginTop: 13 }}>The portal shows one banner at a time — the first live one that matches the firm, preferring a banner aimed at a machine they own. A banner with no line runs everywhere; one with dates runs only between them.</Note>
    </div>
  </>;
}

const MAX_EDGE = 1600;
function downscale(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read that file"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image we can read"));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("Could not process that image"));
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

function BannerForm({ ad, onSaved }: { ad?: Ad; onSaved: () => void }) {
  const { closeModal, openModal, toast } = useUI();
  const { data: lines } = useLines();
  const { data: items } = useApi<{ items: ItemView[] }>("/api/items?line=ALL&q=");
  const [f, setF] = useState({
    title: ad?.title ?? "", sub: ad?.sub ?? "", lineId: ad?.lineId ?? "", itemId: ad?.itemId ?? "",
    startsAt: ad?.startsAt?.slice(0, 10) ?? "", endsAt: ad?.endsAt?.slice(0, 10) ?? "",
    isActive: ad?.isActive ?? true, sortOrder: ad?.sortOrder ?? 0,
  });
  const [url, setUrl] = useState<string | null>(ad?.imageUrl ?? null);
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const its = (items?.items ?? []).filter((i) => i.status === "ACTIVE" && (!f.lineId || i.lineId === f.lineId));

  const save = async () => {
    if (!f.title.trim()) return toast("A banner needs a line of text", "e");
    setBusy(true);
    try {
      const body = { ...f, lineId: f.lineId || null, itemId: f.itemId || null, startsAt: f.startsAt || null, endsAt: f.endsAt || null };
      const saved = ad ? await patch<Ad>(`/api/masters/ads/${ad.id}`, body) : await post<Ad>("/api/masters/ads", body);
      toast(ad ? "Banner updated" : "Banner created — add a picture to it", "s");
      onSaved(); refresh("/api/");
      closeModal();
      // A new banner has no id until it is saved, so it reopens on the saved
      // record — otherwise the picture would have nowhere to attach to.
      if (!ad) openModal(<BannerForm ad={saved} onSaved={onSaved} />, "w");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  const choose = async (file?: File) => {
    if (!file || !ad) return;
    setBusy(true);
    try {
      const data = await downscale(file);
      const r = await post<{ imageUrl: string }>(`/api/masters/ads/${ad.id}/image`, { data });
      setUrl(r.imageUrl); onSaved(); refresh("/api/"); toast("Picture saved", "s");
    } catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); if (pick.current) pick.current.value = ""; }
  };
  const dropImage = async () => {
    if (!ad) return;
    setBusy(true);
    try { await del(`/api/masters/ads/${ad.id}/image`); setUrl(null); onSaved(); refresh("/api/"); toast("Picture removed", "s"); }
    catch (e) { toast(errMsg(e), "e"); } finally { setBusy(false); }
  };

  return <ModalFrame title={ad ? "Edit banner" : "New banner"} onClose={closeModal}
    actions={<><button className="b b-o" onClick={closeModal}>Cancel</button><button className="b b-p" disabled={busy} onClick={save}>{busy ? "Saving…" : ad ? "Save banner" : "Create banner"}</button></>}>

    <div className="fg">
      <Field label="Headline *" full hint="The one line a firm reads first"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Wedding range 2026 — now in stock" /></Field>
      <Field label="Second line" full><input value={f.sub} onChange={(e) => setF({ ...f, sub: e.target.value })} placeholder="e.g. 40 new designs across every community" /></Field>
      <Field label="Show to firms dealing in" hint="Leave on all lines to show it everywhere">
        <select value={f.lineId} onChange={(e) => setF({ ...f, lineId: e.target.value, itemId: "" })}>
          <option value="">All lines</option>
          {lines?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="Tapping it opens" hint="Optional — otherwise it is just a notice">
        <select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
          <option value="">Nothing</option>
          {its.slice(0, 300).map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
        </select>
      </Field>
      <Field label="Runs from" hint="Leave empty to start now"><input type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
      <Field label="Runs until" hint="Leave empty for no end"><input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
      <Field label="Order" hint="Lower shows first when several match"><input type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
      <Field label="Live"><select value={f.isActive ? "y" : "n"} onChange={(e) => setF({ ...f, isActive: e.target.value === "y" })}><option value="y">Yes — show it in the portal</option><option value="n">No — keep it off</option></select></Field>
    </div>

    <div className="st" style={{ marginTop: 16 }}>Picture</div>
    {!ad ? <Note>Create the banner first, then a picture can be attached to it. Without one it shows as a text banner on the maroon panel, which is what the portal has always done.</Note> : <>
      <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
        {url
          ? <img src={url} alt="" style={{ width: 260, aspectRatio: "16/6", objectFit: "cover", border: "1px solid var(--bd)", borderRadius: 5 }} />
          : <div style={{ width: 260, aspectRatio: "16/6", background: "linear-gradient(100deg,#2E1020,#5C1636)", borderRadius: 5, display: "grid", placeItems: "center", color: "rgba(255,255,255,.6)", fontSize: 12.5 }}>Text banner</div>}
        <div style={{ flex: 1 }}>
          <div className="sm" style={{ marginBottom: 8 }}>Landscape reads best — roughly 16:6, the shape shown here. The headline sits over the bottom of the picture, so leave that part uncluttered.</div>
          <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => choose(e.target.files?.[0])} />
          <div style={{ display: "flex", gap: 7 }}>
            <button className="b b-o b-s" disabled={busy} onClick={() => pick.current?.click()}>{busy ? "Working…" : url ? "Replace picture" : "Add picture"}</button>
            {url && <button className="b b-g b-s" disabled={busy} onClick={dropImage}>Remove</button>}
          </div>
          <div className="sm" style={{ marginTop: 7 }}>JPEG, PNG or WebP. Large pictures are shrunk to {MAX_EDGE} px before they are sent.</div>
        </div>
      </div>
    </>}
  </ModalFrame>;
}
