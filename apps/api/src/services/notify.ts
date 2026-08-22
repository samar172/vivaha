import type { NotifKind, Role } from "@prisma/client";
import type { Db } from "../db";

// Broadcast to a role (userId null) or target one user.
export async function notify(db: Db, p: { text: string; kind?: NotifKind; role?: Role | null; userId?: string | null; link?: string | null }) {
  await db.notification.create({
    data: { text: p.text, kind: p.kind ?? "INFO", role: p.userId ? null : (p.role ?? "SUPER_ADMIN"), userId: p.userId ?? null, link: p.link ?? null },
  });
}

export async function notifyRoles(db: Db, roles: Role[], text: string, kind: NotifKind = "INFO", link?: string | null) {
  for (const role of roles) await notify(db, { text, kind, role, link });
}
