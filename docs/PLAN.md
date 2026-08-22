# Vivaha Cards ERP — Build Plan

Source of truth for scope: `docs/reference/vivaha-erp-mockup.html` (client-approved interactive mock, built to BRD + PRD v1.0).
Stack: identical to JMS (`Developer/jms`) — npm-workspaces monorepo.

```
apps/api        Express + TypeScript + Prisma + PostgreSQL   (tsx in dev & prod)
apps/web        Next.js 16 App Router + Tailwind v4 + SWR     (no component lib; console-* CSS)
packages/shared Pure engine: bands, pricing, credit gate, GST, alternates, ageing, permissions
```

## 1. Engine (packages/shared) — ported 1:1 from the mock's JS
- `lines.ts`      BusinessLine config type + pricing/workflow enums
- `stock.ts`      available(), band() (F-01: out/eta/low/ltd/in/svc)
- `pricing.ts`    slabRate, priceFor (slab × group multiplier, override, margin floor 18 %), nextSlab
- `credit.ts`     outstanding, oldestUnpaid (FIFO), creditGate (amount | time breach, WARN/BLOCK, near @85 %), ageing buckets
- `gst.ts`        taxOf (intra/inter by GSTIN state 08), invoiceTotals (per-rate blocks)
- `alternates.ts` scoring 40 group + 25 price-proximity + 15 spec + 10 size + 10 fit, minus returned items
- `permissions.ts` 26 perms, 6 roles (data), `can()`
- `order.ts`      STATUSES, FLOW, allowed transitions

## 2. Data model (apps/api/prisma/schema.prisma)
User/Role/RolePermission · BusinessLine · AttributeDef · Godown · Vendor · Item + PriceSlab · PricingGroup ·
Customer + Contact + Machine + PriceOverride · StockBalance (item×godown×batch, 5 buckets) · StockTxn (append-only) ·
Purchase + PurchaseLine · Transfer · Order + OrderLine + OrderEvent · Dispatch · Invoice + InvoiceLine ·
LedgerEntry (only source of outstanding) · Payment · ReturnRequest · JobWork · Kit + KitSession · Cart ·
Referral · Ad · StockoutSearch · Notification + NotificationRead · AuditLog · Sequence (gapless numbering) · Setting

## 3. API modules (apps/api/src/modules)
auth · masters (lines, godowns, vendors, attributes, pricing groups) · items · stock (balances, adjust, transfer) ·
purchases · customers (incl. overrides, block) · orders (approve/reject/reserve/allocate/pick/pack/stage/dispatch/deliver/revive) ·
returns · ledger (outstanding, invoices, payments, GST summary) · jobs · reports · audit · notifications · settings ·
search (⌘K) · portal (customer-facing: catalogue, sheet, cart, booking, orders, kit, hits, refer, account)
Background job: hold-expiry sweeper (Booked + holdUntil < now → Lapsed, release hold, notify sales exec).

## 4. Web (apps/web)
Internal ERP shell (topbar line-switch, godown selector, ⌘K, notifications, sidebar from perms, footer pager) +
screens: dashboard, items, purchase (invoices/vendors/payables), inventory (position/transfers/ageing/dead/expiry),
customers, orders (5 tabs + drawers + modals), dispatch queue, job work, returns, ledger & GST (4 tabs), reports (+6 detail),
audit, settings (lines/pricing/rbac/attrs/import/data).
Customer portal (`/portal`) — mobile-first, Hindi labels: home, catalogue, sheet, cart, orders, invoice, return, kit, hits, refer, account.

## 5. Seed
Port the mock's seed faithfully (47 items across 4 lines, 16 firms, 3 godowns, 7 vendors, 22 orders in every status,
ledger openings/payments, returns, jobs, kits, referrals, ads) so the built system demos exactly like the mock.

## 6. Order of work
shared → schema + migration → api (auth, masters, items, stock, purchases) → customers + ledger → orders + dispatch →
returns, jobs → reports/search/settings → seed → web shell → ERP screens → portal → smoke test end-to-end.
