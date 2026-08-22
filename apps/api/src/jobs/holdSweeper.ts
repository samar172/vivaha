import { prisma } from "../db";
import { releaseHold, type GodownMap } from "../services/stock";
import { audit } from "../services/audit";
import { notify } from "../services/notify";

// BR-23: a booking hold that expires before office approval lapses — stock is
// released automatically and an alert is raised to the firm's sales executive.
// "Lapsed" keeps the intent (it can be revived), unlike "Cancelled".
export async function sweepExpiredHolds(): Promise<number> {
  const due = await prisma.order.findMany({
    where: { status: "BOOKED", holdUntil: { lt: new Date() } },
    include: { lines: true, customer: { include: { salesExec: true } } },
  });
  for (const o of due) {
    await prisma.$transaction(async (tx) => {
      for (const l of o.lines) await releaseHold(tx, l.itemId, l.alloc as GodownMap, o.id, "Hold expired — auto-released", "System");
      await tx.order.update({ where: { id: o.id }, data: { status: "LAPSED", holdUntil: null } });
      const execName = o.customer.salesExec?.name ?? "sales";
      await tx.orderEvent.create({ data: { orderId: o.id, from: "BOOKED", to: "LAPSED", by: "System", why: `Hold expired before office approval — alert raised to ${execName}` } });
      await audit(tx, { actor: "System", action: "Reservation auto-released", entityType: "Order", entityId: o.id, oldValue: "Booked", newValue: "Lapsed", reason: `Hold expired · alert to ${execName}` });
      const text = `Order ${o.id} lapsed — stock released, alert raised to ${execName}`;
      if (o.customer.salesExecId) await notify(tx, { text, kind: "WARN", userId: o.customer.salesExecId, link: `/orders?open=${o.id}` });
      await notify(tx, { text, kind: "WARN", role: "SUPER_ADMIN", link: `/orders?open=${o.id}` });
    });
  }
  return due.length;
}

export function startHoldSweeper(intervalMs = 15_000) {
  const run = () => sweepExpiredHolds().catch((e) => console.error("holdSweeper", e));
  run();
  return setInterval(run, intervalMs);
}
