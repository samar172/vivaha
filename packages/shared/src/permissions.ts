// RBAC as data (Settings → Roles & permissions in the mock). The nav and every
// action button render from the signed-in role's permission set.
export const ROLES = [
  "SUPER_ADMIN",
  "PURCHASE_MANAGER",
  "SALES_EXECUTIVE",
  "GODOWN_MANAGER",
  "DISPATCH_MANAGER",
  "ACCOUNTS_MANAGER",
  "CUSTOMER",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  PURCHASE_MANAGER: "Purchase Manager",
  SALES_EXECUTIVE: "Sales Executive",
  GODOWN_MANAGER: "Godown Manager",
  DISPATCH_MANAGER: "Dispatch Manager",
  ACCOUNTS_MANAGER: "Accounts Manager",
  CUSTOMER: "Customer (portal)",
};

export const PERMS = [
  "dash.view", "item.view", "item.edit", "purchase.view", "purchase.create",
  "stock.view", "stock.adjust", "stock.transfer",
  "cust.view", "cust.edit", "cust.price", "cust.block",
  "order.view", "order.approve", "order.allocate", "order.pick", "order.dispatch",
  "return.view", "return.process", "ledger.view", "payment.create", "credit.override",
  "margin.override", "report.view", "audit.view", "settings.manage",
] as const;
export type Perm = (typeof PERMS)[number];

export const DEFAULT_ROLE_PERMS: Record<Role, Perm[]> = {
  SUPER_ADMIN: [...PERMS],
  PURCHASE_MANAGER: ["dash.view", "item.view", "item.edit", "purchase.view", "purchase.create", "stock.view", "stock.transfer", "cust.view", "report.view"],
  SALES_EXECUTIVE: ["dash.view", "item.view", "stock.view", "cust.view", "cust.edit", "order.view", "order.approve", "report.view"],
  GODOWN_MANAGER: ["item.view", "stock.view", "stock.adjust", "stock.transfer", "order.view", "order.allocate", "order.pick", "return.view", "return.process"],
  DISPATCH_MANAGER: ["order.view", "order.pick", "order.dispatch", "stock.view"],
  ACCOUNTS_MANAGER: ["dash.view", "cust.view", "cust.block", "order.view", "ledger.view", "payment.create", "credit.override", "return.view", "report.view", "audit.view"],
  CUSTOMER: [],
};

export function hasPerm(perms: readonly string[] | undefined | null, p: Perm): boolean {
  return !!perms && perms.includes(p);
}
