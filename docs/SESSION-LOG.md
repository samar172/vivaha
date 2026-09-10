# Session log

Running record of what changed and why, newest first. Complements the other docs
rather than repeating them: `docs/PLAN.md` is the original build plan,
`docs/DEPLOY.md` is the live runbook, `README.md` is the feature summary.

---

## 2026-09-10 — Push to GitHub, deploy the 10 Sep round, office-raised orders

### 1. The repository reached GitHub

Everything up to `c6cd62e` had only ever existed on this laptop. Pushed to
`github.com/samar172/vivaha`, renaming `master` to `main` on the way. The
`git init` / first-commit sequence in the original instruction was skipped
deliberately — the repo already had five commits and a README, so running it
would have been a no-op or an empty commit.

### 2. The 10 Sep backend round went out

Followed `docs/SAMAR_DEPLOY_2026-09-10.md`. Three migrations applied
(`user_password_lifecycle`, `item_codes`, `purchase_line_mfr_code`), Prisma
client regenerated at 5.22.0, `vivaha-api` restarted. The other three PM2
processes on the box — `jms-api`, `saangri-api`, `election-api` — were left
alone and re-checked afterwards.

nginx §3 applied: `client_max_body_size` raised 25M → 128M and
`proxy_read_timeout 300s` added, so a full-database restore is not rejected at
the proxy before Express sees it. Original config backed up alongside.

**Two things that doc got wrong, both now fixed in it:**

- The `pg_dump` line could never have worked. `DATABASE_URL` carries
  `?schema=public` and `pg_dump` rejects it outright — `invalid URI query
  parameter: "schema"`. The query string has to be stripped first.
- "The frontend goes out on Vercel by itself" was not true. The Vercel project
  has **no git connection**, and its production deployment was 17 days old — a
  push to `main` would never have updated it. It needs a CLI deploy from the
  repo root (Root Directory is `apps/web`, so the root is where the
  `@vivaha/shared` workspace link resolves).

The project also had **no environment variables at all**, so it was silently
riding the `VERCEL` fallback baked into `next.config.ts`. `API_PROXY_TARGET` is
now set explicitly on Production.

Live and verified: login returns a token and the refresh cookie comes back
first-party through the proxy; `/api/settings/users`, `/api/settings/backup/state`
and the new `code` / `codeKind` fields on `/api/items` all respond.

### 3. Orders can be raised from the office

**Asked:** an order should not have to come from a customer — the admin and
employees need to create one.

Until now the only way an `Order` row could exist was a portal cart checkout,
so a telephoned or walk-in order had to be keyed by the customer or not
recorded at all. The seed data already knew better: it carries orders with
`source: "office"` and `bookedBy: "… (assisted)"`, and `reserve()` already had
a branch commented *"Hold was partial/absent (e.g. office-assisted booking)"*.
The concept existed everywhere except the screen.

**New permission `order.create`** — Super Admin and Sales Executive by default.
That is the admin/employee split the request asked for. Because the permission
matrix is editable and lives in the database, a new permission would never
reach an existing deployment on its own; migration `20260910090000_order_create_perm`
inserts the two default rows and leaves a hand-edited matrix alone.

**Three endpoints**, all behind `order.create`: `POST /api/orders` creates,
`POST /api/orders/quote` prices a basket without writing anything, and
`GET /api/orders/catalogue` lists items priced for the firm that is buying.
`/catalogue` is registered *before* `GET /:id`, which would otherwise swallow it.

**The rule that matters:** an office order runs through the same pricing, credit
and stock services as the portal — `pricerFor`, `gateFor`, `stock.tryHold`,
`invoiceTotals` — rather than a second code path. An assisted order therefore
cannot be priced or gated on softer terms than a self-service one. It lands as
`BOOKED`, holds stock, and still goes through approval.

Refused, each with the reason: empty basket, below MOQ, above available, blocked
firm, and an order mixing two business lines — the hold window and the dispatch
queue are both per line, so a mixed order would inherit whichever line sorted
first. A restricted credit gate demands a written reason that lands in the audit
log; a `BLOCK` gate refuses unless the user holds `credit.override`, matching
what the approval screen already does.

**The screen** (`apps/web/src/components/NewOrderModal.tsx`) re-quotes against
the server 250 ms after every change instead of adding up in the browser, and
stamps each quote with the basket it priced — a quote outrun by a keystroke is
ignored rather than displayed as the live total.

**Verified end to end** against a local API: ORD-1084 for Sharma Wedding
Planners priced ₹53 → ₹46 at qty 500 (slab), split GD-A 500 / GD-B 100, hold
0 → 500 and available 1650 → 1150; approve → reserve carried it through the
normal pipeline; both audit rows written. Test order cancelled afterwards.

**Not verified by eye:** the Claude Chrome extension was not connected, so the
modal's rendering was never seen in a browser. The API underneath it is tested.

### Open after this session

- **`apps/web/.env` points local development at the production API.** Anyone
  running `npm run dev:web` is driving the live backend from their laptop. The
  local API was used for all testing here by overriding `API_PROXY_TARGET` on
  the command line, but the file itself should be changed.
- `apps/web/tsconfig.tsbuildinfo` is tracked in git and churns on every
  typecheck — it belongs in `.gitignore`.
- One pre-existing eslint error in `apps/web/src/components/Qr.tsx`
  (`react-hooks/set-state-in-effect`). Does not block the build.
- The Vercel project is still not git-connected. `vercel git connect` would fix
  it, but note the runbook's warning: auto-deploy can promote the frontend
  before the API box is updated.
- README "Not yet done" list otherwise unchanged: real camera scanning,
  server-side Excel/PDF exports, WhatsApp delivery, item image upload, physical
  stock-count session.

---

## 2026-08-24 — QR/scan audit, admin-panel icons, backend deployment

Work committed 2026-08-24; this log written 2026-09-10.

Three separate threads in one session: a question about a missing feature (it
wasn't missing), a UI polish pass on the admin panel, and the first real
deployment of the API.

### 1. The "QR flow" question — nothing was missing

**Asked:** whether the QR flow from the HTML mockup had been skipped in the build.

**Finding:** there is no QR anywhere in the client mockup. Searching
`docs/reference/vivaha-erp-mockup.html` for `qr` and `barcode` returns zero hits.
What the mockup has is a **camera scan** flow (`doScan()`), and that was built.

It lives in the **customer portal**, not the office ERP — which is why it looks
absent if you are signed in as `admin`. Reach it from the **Customer Portal** tab
on the login screen (`sharma_wedding` / `demo123`). Two places:

1. **Portal home** (`apps/web/src/app/portal/page.tsx`) — the `📷 कार्ड स्कैन करें`
   button plus the "या डिज़ाइन नंबर टाइप करें — DSN-2451" typeahead beneath it.
   Both hit `GET /api/portal/scan` (`apps/api/src/modules/portal/portal.routes.ts:74`).
2. **Kit page** (`apps/web/src/app/portal/kit/page.tsx`) — the full correction
   session: start → scan one card at a time → progress bar → four buckets
   (मिले / नहीं मिले / हटाएं / सूची में नहीं) → finish, which pushes the missing
   items into the cart. Backed by `/api/portal/kit/{start,scan,pause,finish}`.

**Verified live against the running API:**

- `GET /api/portal/scan?q=__random__` → `WC-1045 / DSN-2449 — Swarna Embossed
  Wedding Card`, band "Only 180 left — below full set"
- `GET /api/portal/scan?q=DSN-24` → 5 matching designs
- `GET /api/portal/kit` → Sharma's kit `KIT-2026-S2`, 25 expected cards,
  last checked 23 Jun 2026

**The one real gap:** exactly as in the mockup, the scan button *simulates* a
read — it picks a card from the customer's enabled line rather than opening the
camera. Making it a genuine scanner (`getUserMedia` + `BarcodeDetector`, falling
back to the typed design number where unsupported) would also need each card to
carry a printed code, and the item master has no field for one yet. Still listed
under "Not yet done" in the README.

**Note for future sessions:** the login username for a portal firm is the slug
(`sharma_wedding`), not the display name ("Sharma Wedding Planners"). Posting the
display name to `/api/auth/login` returns `Invalid username or password`.

### 2. Emoji replaced with icons across the admin panel

**Asked:** use icons instead of emoji in the admin panel.

Added **`apps/web/src/components/icons.tsx`** — 28 hand-written stroke icons on a
24px grid, drawn in `currentColor`, no icon package and nothing external to load
(which matters for the self-contained demo). One `<Icon n="..." s={16} />`
component plus a `KIND_ICON` map shared by toasts and notification rows.

Icon names: `grid tag inbox warehouse users receipt truck printer undo rupee
chart history sliders menu pin search bell user x check alert info camera swap
download chevronL chevronR chevronD`.

Swapped throughout the ERP:

- **Sidebar nav** — all twelve entries. `NAV[].i` changed from an emoji string to
  a typed `IconName`. The plain-text `▦` (dashboard) and `₹` (accounts) became
  icons too, otherwise the column looked half-converted.
- **Topbar** — pin on the godown selector (with a real chevron), magnifier in the
  search bar, bell on notifications, person on the role chip, hamburger on mobile.
- **Command palette (⌘K)** — same nav icons on the "Go to" rows; pin / receipt /
  tag / users on godown, order, item and customer results.
- **Toasts and notifications** — check, cross, alert-triangle, info circle, still
  tinted by kind, in both the toast strip (`lib/ui.tsx`) and the notification
  drawer (`Shell.tsx`).
- **Tables and controls** — magnifier in every filter search box (items,
  customers, orders, stock, purchase, audit), × on filter chips, download arrow
  on every CSV export button, printer on dispatch labels, transfer arrows on
  stock transfer, pin on the dispatch tehsil groupings and the tehsil report,
  camera on the returns "photo" badge.
- **Data indicators** — tick/cross cells in the RBAC permission matrix, the
  step-complete circles in the job and import steppers, and the "x / y allocated"
  summaries in the GRN and order allocation modals.
- **`components/ui.tsx`** — × close buttons on `ModalFrame` and `DrawerFrame`.

Seven CSS rules appended to `globals.css` for alignment and nav-icon colour
(grey when inactive, accent when active, centred when the sidebar is collapsed).

**Deliberately left alone:** the customer portal keeps its emoji (`📷` scan, `🛒`
cart, `🧾` orders). They are part of the Bharat-first, low-literacy design in the
client's mock, where the pictograph does real work for the reader. Also left as
plain text: typographic arrows in flow labels ("Booked → Approved") and the ↑↓
sort indicators in table headers — those are text, not emoji.

Result: 20 files changed, zero emoji left anywhere under `app/(erp)/`,
`tsc --noEmit` clean, ESLint unchanged at 0 errors / 21 pre-existing warnings,
all ERP routes still 200.

### 3. Backend deployed to `saangri`

**Asked:** deploy the backend the same way JMS is deployed, on the same box, with
JMS and its database untouched; frontend to Vercel by hand afterwards.

Live at **`https://vivaha-api.98.70.37.83.nip.io`**. Full runbook in
`docs/DEPLOY.md`; the shape of it:

| | |
|---|---|
| Path | `/opt/apps/vivaha` |
| PM2 | `vivaha-api`, fork mode, `tsx` against `src/server.ts` — no build step |
| Port | 4004 (jms-api 4002, saangri-api 4000 were already taken) |
| DB | local Postgres, database `vivaha`, own role `vivaha` |
| nginx | `/etc/nginx/sites-available/vivaha-api.98.70.37.83.nip.io` |
| TLS | Let's Encrypt via certbot, auto-renewing, expires 2026-11-21 |

Pattern copied from JMS's `HANDOFF.md` §6, including the dry-run rsync and the
pre-deploy `pg_dump`.

**Isolation from JMS** was the explicit constraint. Nothing shared: separate
directory, separate Postgres role and database, separate PM2 process, separate
nginx vhost, separate certificate. `/opt/apps/jms`, `/opt/apps/saangri` and both
their databases were never written to. Re-checked after finishing — all three PM2
processes online, `jms-api` still answering `/health`.

Server notes worth keeping: the VM runs **Node 20.20.2** even though `.nvmrc`
says 22 (JMS runs the same way, and the API stack is fine on 20). `npm install`
at the workspace root pulled 133 packages and resolved Prisma to **5.22.0** — the
version this project needs; the `^5.19.1` caret is what keeps Prisma 7 out.

Migrated, generated, and seeded: **53 items, 16 firms, 22 orders**.

**Verified over HTTPS:** `/health` ok; login as `admin`/`demo123` returns a token;
`/api/dashboard`, `/api/orders` (22) and `/api/items` (53) all return real data;
HTTP redirects 301 to HTTPS; PM2 saved so it survives reboot; `pm2 logs` clean.

### 4. Making the frontend deployable to Vercel

Two code changes were needed before the web app could be deployed.

**`next.config.ts` — configurable proxy target.** The `/api` rewrite was
hardcoded to `http://127.0.0.1:4100`, which cannot work on Vercel. It now reads
`API_PROXY_TARGET`.

**Why proxy rather than call the API directly.** The browser only ever talks to
the Vercel origin, so the refresh cookie stays first-party. Pointed straight at
the API host it becomes a third-party cookie, which Safari and Brave block by
default — the client's session would die silently ~30 minutes in, when the access
token expired. So: set `API_PROXY_TARGET`, **not** `NEXT_PUBLIC_API_URL`.

**The build-time trap.** Next evaluates `rewrites()` at *build* time, not runtime.
A fresh Vercel project with no env vars set would bake in the localhost fallback
and every API call from the deployed site would fail. Fixed by falling back to
the deployed API URL whenever `process.env.VERCEL` is set; the env var still
overrides. Confirmed by building with `VERCEL=1` and grepping
`.next/routes-manifest.json` for the baked-in destination.

**CORS for the direct path anyway** (`apps/api/src/app.ts`, `env.ts`): origins are
still a comma list in `CORS_ORIGIN`, plus a new opt-in `ALLOW_VERCEL_ORIGINS=true`
that permits any `https://*.vercel.app` host — Vercel gives every preview
deployment its own hostname, so they cannot be enumerated ahead of time. Off by
default. The refresh cookie already flipped to `Secure; SameSite=None` under
`NODE_ENV=production`, which is why `NODE_ENV` matters in the server `.env`.

**Vercel settings:** Root Directory `apps/web`; env var `API_PROXY_TARGET =
https://vivaha-api.98.70.37.83.nip.io`. Vercel detects the npm workspace root
above `apps/web` and installs from there, which is what makes the `@vivaha/shared`
workspace dependency resolve — that package ships as TypeScript source and is
compiled through `transpilePackages`, so it genuinely needs the workspace link.
If a build fails on an unresolved `@vivaha/shared`, the fix is the "Include files
outside the root directory" setting.

**Verified:** production `next build` succeeds; served locally with
`API_PROXY_TARGET` pointed at the live API, `/api/auth/demo-logins` and
`/api/auth/login` both flow through the proxy and the cookie comes back correctly.

### Commits

| | |
|---|---|
| `be0a885` | ERP: replace emoji glyphs with inline stroke icons |
| `cea7885` | Deploy API to saangri; make web deployable to Vercel |
| `c6cd62e` | Web: default the API proxy target to the deployed API on Vercel |

### Open after this session

- Frontend not yet live — user was mid-`vercel --prod` at session end.
- Commits are local only; nothing pushed to a remote. *(Done 10 Sep 2026.)*
- README "Not yet done" list otherwise unchanged: real camera scanning,
  server-side Excel/PDF exports, WhatsApp delivery, item image upload, physical
  stock-count session.

---

## 2026-08-22 — Initial build

Scaffold, engine, API, seed, ERP screens and customer portal, then the demo-login
trim. See `docs/PLAN.md` for the plan these followed and commits `62fdcbd`,
`ca8b1d7`, `a58d47c`, `4cb7cb9`.

Notable decision from that session: staff users are **deactivated
(`isActive=false`), never deleted** — `Customer.salesExecId`, `AuditLog.userId`
and `Notification.userId` all reference them, so a hard delete breaks seeded
history. Only `admin` is active; `/api/auth/demo-logins` filters on `isActive`,
which is what keeps the login picker down to one internal user.
