# Vivaha Cards ERP — Wholesale Operations Suite

Wholesale distribution ERP + Hindi-first customer portal for Vivaha Cards, Bikaner. Built to the
client-approved interactive mock (`docs/reference/vivaha-erp-mockup.html`) on the same stack as JMS.

## Stack
- **apps/api** — Express + TypeScript + Prisma + PostgreSQL (`tsx` in dev and prod, no build step needed)
- **apps/web** — Next.js 16 (App Router) + Tailwind v4 + SWR. Styling is the mock's own CSS vocabulary, ported 1:1 into `globals.css`
- **packages/shared** — the pure engine, used by API (source of truth) and web (live previews): bands, pricing, credit gate, GST, alternates, ageing, RBAC permissions

## Getting started
```bash
nvm use                       # Node 22
npm install
createdb vivaha
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL + two secrets
npm run db:migrate            # prisma migrate dev
npm run db:seed               # demo data identical to the mock
npm run dev:api               # http://localhost:4100
npm run dev:web               # http://localhost:3100 (second terminal)
```
Demo logins (password `demo123`): office `admin`. Portal (Customer tab): `sharma_wedding`,
`rajputana_cards`, `golden_invites`. The other staff users exist but are seeded inactive, so the
login picker shows one internal user — see [docs/SESSION-LOG.md](docs/SESSION-LOG.md).

## What's implemented (everything in the mock)
**Engine** — five-bucket stock (on hand / reserved / hold / damaged / quarantined) computed live, FEFO for batch items;
display bands (In / Limited / Only N left / Arriving / Out); slab × group-multiplier pricing with per-customer overrides
and an 18 % margin floor; dual credit gate (amount or ageing, WARN/BLOCK per firm); GST intra/inter by GSTIN state code
with per-rate blocks and gapless `VC/26-27/NNNN` numbering; alternate-item ranking; ledger as the only source of outstanding.

**Internal ERP** — Dashboard · Items & Rates · Purchase & GRN (weighted-average landed cost) · Inventory (position,
transfers, ageing, dead stock, expiry) · Customers (gate, overrides, block) · Orders (Booked → … → Delivered, credit-gate
override, godown allocation, partial dispatch → invoice → ledger, Lapsed/Revive) · Dispatch queue by tehsil · Job Work
(proof gate before printing, base cards drawn via stock) · Returns (inspection decides bucket → credit note) · Ledger & GST
(outstanding/ageing, invoice register, receipts, HSN summary, GSTR-1 CSV) · Reports (velocity, stock-out demand, margin,
conversion, reorder prediction, tehsil cluster, payment behaviour, kit health, …) · Audit log · Settings (business lines as
data, multipliers, editable RBAC matrix, attribute masters, import wizard).

**Customer portal** — scan / design-number lookup, catalogue with facets, product sheet (slabs, "add N more → save ₹X",
own open bookings with live hold timer, alternates + split booking), cart with credit box, atomic multi-godown hold on
booking, orders with Hindi status, invoice, return request, kit correction (scan session → 4 buckets → replenishment
cart), district hits, refer & earn, account statement.

**Background** — hold sweeper lapses expired bookings every 15 s, releases stock, and alerts the sales executive.

## Repo layout
```
apps/api/prisma/schema.prisma   physical model
apps/api/prisma/seed.ts         demo data (ported from the mock)
apps/api/src/services/          stock engine, items view, pricing, credit, sequence, audit, notify
apps/api/src/modules/*          one router per screen + portal
apps/api/src/jobs/holdSweeper   BR-23 hold expiry
apps/web/src/app/(erp)/*        one folder per ERP screen
apps/web/src/app/portal/*       customer portal
apps/web/src/components/        Shell (topbar/sidebar/palette/notifications), drawers, modals, portal sheet/cart
packages/shared/src/            engine
```

## Not yet done
- Real camera scanning in the portal (the scan button simulates a read; the design-number search is real)
- Server-side Excel/PDF exports (CSV works everywhere; Excel/PDF buttons are queued stubs)
- WhatsApp delivery (invoice/statement/nudge buttons toast instead of sending)
- Image upload for items (procedural artwork is used, `Item.imageUrl` is ready)
- Physical stock count session (button is a stub; adjustments and transfers are real)
- Frontend deployment — the API is live at `https://vivaha-api.98.70.37.83.nip.io`; Vercel setup is in [docs/DEPLOY.md](docs/DEPLOY.md)

## Docs

- [docs/PLAN.md](docs/PLAN.md) — the original build plan
- [docs/DEPLOY.md](docs/DEPLOY.md) — deploy/redeploy runbook for API and web
- [docs/SESSION-LOG.md](docs/SESSION-LOG.md) — what changed each session, and why
