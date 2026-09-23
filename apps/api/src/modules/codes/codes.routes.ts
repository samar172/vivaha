import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { asyncHandler } from "../../utils/asyncHandler";
import { requirePerm } from "../../middleware/auth";
import { audit } from "../../services/audit";
import { badRequest, notFound } from "../../utils/httpError";
import { getCodePrefix } from "../../services/settings";

const router = Router();

const codeSelect = {
  id: true, code: true, itemId: true, kind: true, status: true, note: true, by: true,
  createdAt: true, replacedAt: true, replacedById: true,
  vendor: { select: { id: true, name: true } },
};

// The office's own code. Human-readable on purpose: it gets written on cartons
// and read back over the phone, so it carries the design number, not a hash.
// The prefix is the firm's, not ours — a shop called Jain Card Gallery should
// not be issuing codes that start VC.
export function ownCodeFor(designNo: string | null, sku: string, prefix = "VC", name?: string | null) {
  // The design number first, because that is what the trade calls the card.
  //
  // Falling straight back to the SKU was a mistake: WC-1002 is the key the
  // system generates and nobody thinks in, and suggesting VC-WC-1002 dragged it
  // straight back into the one code meant to replace it — so it went on labels,
  // on the picker and on bills after all that work to hide it. The item's own
  // name is a better answer, and the SKU is a last resort for an item with
  // neither, which cannot happen in practice since a name is mandatory.
  const slug = (v: string) => v.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase();
  const fromName = name ? slug(name).slice(0, 20).replace(/-+$/, "") : "";
  const body = (designNo && slug(designNo)) || fromName || slug(sku);
  return `${prefix}-${body}`;
}

// Resolve ANY code — the office's own or a manufacturer label that was replaced
// years ago. A replaced code still answers, and says what replaced it.
router.get("/resolve", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const { code } = z.object({ code: z.string().min(1) }).parse(req.query);
  const hit = await prisma.itemCode.findUnique({
    where: { code: code.trim() },
    include: {
      vendor: { select: { id: true, name: true } },
      item: { include: { line: { select: { id: true, name: true } }, codes: { where: { status: "ACTIVE" }, select: codeSelect } } },
      replacedBy: { select: { code: true, kind: true } },
    },
  });
  if (!hit) return res.status(404).json({ error: `No item carries the code "${code}"` });
  res.json({
    code: hit.code, kind: hit.kind, status: hit.status, vendor: hit.vendor, note: hit.note,
    replacedBy: hit.replacedBy,
    item: { id: hit.item.id, sku: hit.item.sku, designNo: hit.item.designNo, name: hit.item.name, nameHi: hit.item.nameHi, lineId: hit.item.lineId, line: hit.item.line, artSeed: hit.item.artSeed, imageUrl: hit.item.imageUrl },
    activeCodes: hit.item.codes,
  });
}));

// What this item's own code would be if nobody typed one — so the screen can
// show it in the box rather than making somebody guess the convention.
router.get("/item/:itemId/suggest", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const item = await prisma.item.findUnique({ where: { id: req.params.itemId }, select: { designNo: true, sku: true, name: true } });
  if (!item) throw notFound("Item not found");
  const suggested = ownCodeFor(item.designNo, item.sku, await getCodePrefix(), item.name);
  const taken = await prisma.itemCode.findUnique({ where: { code: suggested }, select: { itemId: true } });
  res.json({ suggested, free: !taken || taken.itemId === req.params.itemId });
}));

router.get("/item/:itemId", requirePerm("item.view"), asyncHandler(async (req, res) => {
  const rows = await prisma.itemCode.findMany({ where: { itemId: req.params.itemId }, select: codeSelect, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  res.json(rows);
}));

// Record a code that arrived on the goods — the manufacturer's label.
router.post("/item/:itemId/manufacturer", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const b = z.object({ code: z.string().min(2), vendorId: z.string().optional(), note: z.string().optional() }).parse(req.body);
  const item = await prisma.item.findUnique({ where: { id: req.params.itemId } });
  if (!item) throw notFound("Item not found");
  if (await prisma.itemCode.findUnique({ where: { code: b.code } })) throw badRequest(`Code "${b.code}" is already on file`);
  const row = await prisma.itemCode.create({
    data: { code: b.code.trim(), itemId: item.id, kind: "MANUFACTURER", vendorId: b.vendorId ?? item.vendorId, note: b.note ?? null, by: req.user!.name },
    select: codeSelect,
  });
  await audit(prisma, { userId: req.user!.id, actor: req.user!.name, action: "Manufacturer code recorded", entityType: "Item", entityId: item.sku, newValue: b.code });
  res.status(201).json(row);
}));

// Re-label: issue the office's own code. The code being replaced is kept and
// flipped to REPLACED with a pointer to its successor — never deleted, because
// a vendor claim or a recall has to be able to walk back to the original label.
router.post("/item/:itemId/relabel", requirePerm("item.edit"), asyncHandler(async (req, res) => {
  const b = z.object({
    code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9\-_/]*$/, "A code is letters, numbers and dashes — it gets written on a carton and read back over the phone").optional(),
    replacesCodeId: z.string().optional(), note: z.string().optional(),
  }).parse(req.body);
  const item = await prisma.item.findUnique({ where: { id: req.params.itemId } });
  if (!item) throw notFound("Item not found");

  // Suggested, never imposed: the office may have its own marking convention,
  // and a code somebody types is the one that ends up written on the carton.
  const code = b.code?.trim() || ownCodeFor(item.designNo, item.sku, await getCodePrefix(), item.name);
  const clash = await prisma.itemCode.findUnique({ where: { code } });
  if (clash) throw badRequest(clash.itemId === item.id ? `This item already carries "${code}"` : `Code "${code}" belongs to another item`);

  let replaced: { id: string; code: string } | null = null;
  if (b.replacesCodeId) {
    const old = await prisma.itemCode.findUnique({ where: { id: b.replacesCodeId } });
    if (!old || old.itemId !== item.id) throw badRequest("The code being replaced is not on this item");
    if (old.status === "REPLACED") throw badRequest(`"${old.code}" was already replaced`);
    replaced = { id: old.id, code: old.code };
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.itemCode.create({
      data: { code, itemId: item.id, kind: "OWN", status: "ACTIVE", note: b.note ?? null, by: req.user!.name },
      select: codeSelect,
    });
    if (replaced) {
      await tx.itemCode.update({ where: { id: replaced.id }, data: { status: "REPLACED", replacedById: created.id, replacedAt: new Date() } });
    }
    await audit(tx, {
      userId: req.user!.id, actor: req.user!.name,
      action: replaced ? "Item re-labelled with own code" : "Own code issued",
      entityType: "Item", entityId: item.sku,
      oldValue: replaced?.code ?? "", newValue: code,
      reason: replaced ? "Manufacturer label replaced — original kept for traceability" : "",
    });
    return created;
  });
  res.status(201).json(row);
}));

export default router;
