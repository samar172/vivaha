import type { Db } from "../db";

export async function audit(
  db: Db,
  p: { userId?: string | null; actor: string; action: string; entityType: string; entityId: string; oldValue?: unknown; newValue?: unknown; reason?: string; ip?: string | null }
) {
  await db.auditLog.create({
    data: {
      userId: p.userId ?? null,
      actor: p.actor,
      action: p.action,
      entityType: p.entityType,
      entityId: p.entityId,
      oldValue: p.oldValue == null ? "" : String(p.oldValue),
      newValue: p.newValue == null ? "" : String(p.newValue),
      reason: p.reason ?? "",
      ipAddress: p.ip ?? null,
    },
  });
}
