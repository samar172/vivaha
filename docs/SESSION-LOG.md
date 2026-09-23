# Session log

Running record of what changed and why, newest first. Complements the other docs
rather than repeating them: `docs/PLAN.md` is the original build plan,
`docs/DEPLOY.md` is the live runbook, `README.md` is the feature summary.

---

## 2026-09-23 — Why the install prompt never appeared on a phone

Reported as "works on desktop, not on mobile". Three separate faults, every one
of them invisible on a desktop, and a fourth found while fixing them.

**The event was arriving before React did.** Chrome fires `beforeinstallprompt`
once, early. On a handset it routinely fires while the page is still hydrating,
so the listener React attached afterwards got nothing — and the old code called
`preventDefault()` on that event, which also suppresses Chrome's own mini-
infobar. A missed event therefore left the user with no door at all: no card,
and no infobar either. It is now captured in a boot script that runs while the
document is still parsing, parked on the window, and read by whatever mounts
later through `useSyncExternalStore` — because the offer is the browser's state,
not React's.

**No service worker on the first page anybody sees.** Registration lived inside
the signed-in shell. A first visit lands on `/login`, which is outside it, so
Chrome on Android — which will not offer to install a page with no service
worker — was being asked to install a page that had none. Registered from the
boot script now, on every page, signed in or not.

**The shop was being offered as the office.** `/portal` was served with the ERP
manifest in its HTML and only swapped after hydration, so a retailer could be
offered `start_url: /dashboard`. The boot script sets it from the path before
Chrome reads it, and `ManifestForRoute` keeps it in step afterwards — a visitor
bounced from `/portal` to `/login` was otherwise left holding the shop's.

**Silence on the browsers with no event.** iOS Safari was handled; Chrome, Edge
and Firefox *on iOS* were not — they were treated as prompt-capable, so nothing
ever showed. They cannot install at all: Apple allows it only from Safari, and
saying "tap Share" in Chrome on an iPhone sends somebody looking for a button
that will never work. They are now told to open the page in Safari. Firefox and
Samsung Internet on Android are told where their own menu item is. Every
browser gets an answer; none gets silence.

**And a permanent door.** Any timed card can be missed or waved away, and the
dismissal lasts a fortnight. `InstallButton` is always reachable — *Install app*
in the office profile drawer, and on the shop's account screen — and it ignores
the dismissal, because somebody pressing it has asked.

### Verified

In Chrome against the production build: the event captured on `/login` before
any shell mounted; the service worker registered and controlling from that same
first page; the manifest following the route through a signed-out bounce; the
card rendering with a working Install; and — the actual reported failure —
clearing the event mid-session leaves the card up with the browser-menu route
rather than disappearing. The permanent button is in the drawer.

Also fixed in passing: the profile drawer said "N of 26 permissions", a number
that went stale the moment a capability was added. It counts.

---

## 2026-09-18 — Correcting a bill, and capabilities given to a person

Two asks, one behind the other: an edit-bill option for the Super Admin, and
the ability to hand that — and editing customers, items, purchases — to named
employees.

### A role cannot answer the question being asked

Permissions were already data rather than code, editable from Settings → Roles
& permissions, and they already gated the navigation and every action button.
What they could not express is "Rahin, and only Rahin, may correct a bill",
because a role answers what a *job* does. The office's way round that is to
widen the whole role, which is how everybody ends up able to do everything.

`UserPermission` is a capability given to, or withheld from, one person, on top
of whatever their role carries. Three states per capability rather than two —
*from the role*, *granted*, *withheld* — because the withholding is the other
half of the same question: take dispatch off one person while the role keeps it.

Only the **difference** from the role is stored. A grant that repeats what the
role already says is noise, and would go stale the moment somebody edits the
role. Resolved per request rather than trusted from the token, so a capability
taken away this morning is gone on the next click, not at the next sign-in —
verified from the employee's own live session.

Two guards, both of which exist to stop the system locking itself: nobody edits
their own capabilities, and a Super Admin cannot be withheld `settings.manage`.

### Correcting a bill is an amendment, not an edit

A tax invoice is not an ordinary record. The number is filed, the ledger is
posted from it and the GST return is built out of it. So:

- the number never changes and is never reused;
- what the bill said before is kept — every line, before and after, with who
  changed it and why — and printed **on the bill**, not buried in the audit log,
  because a customer holding an earlier copy is entitled to know this one differs;
- the ledger is put right with a fresh entry. The original debit stays exactly as
  posted; a reduction posts a credit, an increase a further debit, and outstanding
  recomputes off the ledger as it always has. The statement reads as what
  happened, not as what we wish had happened.

The one thing it will not do is bill more than left the godown. Quantity is
checked against the order's shipped figure, across every posted bill on that
order. A rate below the margin floor needs `margin.override`, the same rule the
pricing engine holds. A reason of four characters or more is mandatory.

Said plainly on screen rather than left to be worked out: **changing a billed
quantity moves the money, not the stock.** If the goods came back, that is a
return — which is what puts them on the shelf and credits the firm for them.

`invoice.amend` is granted to **no role by default**, not even Accounts. Super
Admin has it by way of holding everything; anyone else is given it by name. That
is the whole point of a per-person grant.

### Also

Invoice lines had no ordering on their reads, so Postgres was free to shuffle
them once a row had been updated — a tax invoice whose lines reorder after a
correction. Ordered explicitly now, and asserted.

### Verified

46 checks, all passing: the grant round trip (granted, withheld, only-the-
difference, mid-session effect, both guards), and the amendment (refusals for no
reason / no change / over-billing, the recomputed total against the rule rather
than against itself, the number unchanged, the trail, the original debit intact,
the compensating entry, outstanding falling by exactly the difference, line order
stable, and a correction upwards putting it all back).

---

## 2026-09-18 — Racks, first-in-first-out, and sending goods by bus

Five client items. Four were features; the first was a modelling mistake the
office had been working around for months.

### A godown is a building; a rack is a shelf in it

There was only ever one kind of place — `Godown` — so when the office needed to
record which rack a bundle went on, it made a "godown" per rack. That is why the
transfer screen could move goods between two shelves of the same room as if they
were separate premises, and why the dispatch queue listed a column of "godowns"
that were one address.

`Rack` is now its own master, hanging off the godown it belongs to, editable
under **Settings → Godowns & racks**. `StockBalance` carries the rack as part of
its key, so a pile on R-1 and a pile on R-3 are different rows, and `StockTxn`
records which rack each movement came off. A rack that has held stock is retired,
never deleted: the movement log names it by its code.

Stock is still counted and reserved **per godown** — that is the number an order
asks about, and making reservation rack-aware would have meant the sales screen
knowing about shelves. The rack rides along so the picker is told where to go.

The goods-receipt screen changed shape to match. It used to be one number box
per godown laid out across the form — with four godowns the operator typed three
zeroes to record one delivery, and the receive modal opened on a hard-coded
`GD-A / GD-B / GD-C` split that is a list of godowns a firm may never have had.
A putaway is now a row the operator adds: choose the godown, choose the rack,
type how many. Most receipts are one row.

`PurchaseLine.places` holds `[{godownId, rack, qty}]`; `alloc` stays as the
godown roll-up, and is derived from `places` on the way in so the two cannot
drift. Every screen and the whole reservation engine still read `alloc` and did
not have to change. Documents raised before racks existed were backfilled into
`places` with the rack unrecorded.

### First in, first out

`StockBalance.firstIn` is stamped the first time a pile is stocked and never
moved after — topping a rack up does not make the stock underneath it younger.
Backfilled from the earliest inward movement on file; rows with nothing on file
keep NULL and sort **last**, because we do not know when they landed and guessing
would push them ahead of stock we do know about.

Two things use it. The stock engine now picks expiry-first, then oldest-first,
whenever a quantity has to come out of a godown holding several piles — so a
card sitting since last season leaves before the one that landed in June. And
the allocation screen has an **Auto-allocate · oldest stock first** button, per
line or for the whole order, next to the by-availability split a booking takes.

### Sending goods by bus

A transport company issues an LR and the consignment can be traced through it. A
great deal of this trade does not work that way: the bundle is handed to the
conductor of the evening bus, and there is no LR, no booking office and nobody
to ring. What the firm needs then is the bus number, the driver's phone, the time
it was loaded and a photograph of the bundle actually on board — that *is* the
consignment note.

`Dispatch.mode` is `TRANSPORT` or `BUS`; the modal swaps the fields rather than
showing both and leaving half blank. Each mode has one thing that cannot be
blank, enforced on the server as well as the form: an LR for a transporter, a bus
number and a driver's phone for a bus. The photographs travel as data URLs on the
dispatch body — the browser has already redrawn them to 1400px — and are stored
the same way item photographs are.

Then the message. Everything the firm needs is recorded by the time the
consignment is saved, so it writes itself; it opens ready-addressed on WhatsApp
to whichever of the firm's numbers is chosen, and a person presses send. The same
rule a bill follows, and it is recorded the same way — `DispatchShare` says *sent
from here*, never *delivered*, because WhatsApp does not tell us the rest.

### What ticking a business line actually gets a firm

"Deals in" read like a label. It now opens a list, on the same screen, as soon as
a line is ticked: every live product on it, with what is in stock. Nothing is
chosen there — it exists so nobody has to save the customer and go hunting
through the catalogue to find out whether they were given the right lines.

### Found while testing

Creating an item picked its SKU as `1000 + count×3 + random(0..2)`. On a
well-stocked line that collides with an already-issued code often enough to
matter, and SKU is unique — so the collision was a 500 and the office lost the
form. It now takes the first free number from that point. Not on the client's
list; it turned up because it broke the harness twice in a row.

### Verified

31 targeted checks on the new paths (racks, placements, the godown roll-up,
FIFO drain order, both dispatch modes and their refusals, the photograph, the
share record), and the 241-check end-to-end harness re-run against a clean
database: 237 pass, 4 fail — all four are the cards line being seeded with
`allowCustomPricing: false` where production has it true, so the harness's
per-item price overrides are correctly refused. No regression.

---

## 2026-09-11 — The twenty-point update round

A client list of twenty changes, under a standing instruction: analyse what
exists, extend it, do not rebuild. The most useful finding was how much was
already built and simply never connected.

### What was already there

`CustomerContact` modelled a firm's numbers with a role, a phone and an
authority, and nothing had ever written to it. `Item.imageUrl` had existed since
the first build and `thumb()` had always preferred a real photograph over the
generated artwork — the field was never set. `priceFor()` was already the only
place a rate was decided. `Referral` had a code on every firm, a portal
submission screen and a reward on the row, with nothing able to read it back.
`Cart`, `Ad`, `CustomerMachine`, `/api/codes/resolve` and the portal's bottom
bar all existed. Because `BusinessLine` is pure configuration, separating Flex
from ACP needed no pricing, order, stock or report code at all.

Three things genuinely did not exist: geo-tagging, item price history, and any
WhatsApp integration whatsoever — all eight "Send on WhatsApp" buttons were
toasts that did nothing.

### Bugs found and fixed — seven, all live

**Manual order creation (the one reported).** A firm with job work enabled was
offered it in the line picker, and every one of its five items refused with
"Only 0 available", sending the operator hunting for stock that cannot exist.
Job work is quoted and produced through `JobWork`; it holds no `StockBalance`
rows. The order path never checked `BusinessLine.workflow`.

**Zero-length holds.** `holdUntil` was `now + holdMins`, and a job-work line is
configured `holdMins: 0` — an already-expired hold. `holdSweeper` lapses any
BOOKED order past its hold and runs every fifteen seconds, so had such an item
ever carried stock the order would have been auto-lapsed and its stock released
within seconds, blaming the firm's sales executive in the alert. The portal
booked through the identical expression.

**A dated customer-id collision.** The `CUST` sequence was seeded to the number
of seeded firms, sixteen, while their ids run CUST-101..CUST-116. New firms were
numbered from CUST-17 and the eighty-fifth would have been handed CUST-101 — an
id already in use — failing customer creation permanently from then on.

**Portal logins returned 500 every time.** `await import("bcryptjs")` — the only
dynamic import in the codebase — puts CommonJS exports behind `.default`, so
`bcrypt.hash` was undefined. The route now also sets `mustChangePassword`, so a
login issued from the customer screen follows the same temporary-password policy
as one issued from Settings.

**The portal's half of the job-work dead end**, same root cause, customer side.

**The bottom navigation had never been styled.** Its rule named `.pnav button`
while every tab rendered as a link.

**Two faults in the runbooks themselves** — see below.

### Pricing: five requirements, one engine

Percentage arrangements, firm-wide discounts, the cards-versus-negotiated rule,
price history and pricing-at-creation turned out to be one piece of work.
`PriceOverride` gained a mode, so "eight per cent off list" stays correct when
the list moves instead of being frozen into rupees by hand. `Customer` gained a
firm-wide percentage. Whether a line carries per-firm pricing at all is now
configuration — cards are a published list, flex and ACP are negotiated — rather
than a rule people were expected to remember. `ItemPriceHistory` records
movements of the slab 1 rate and the landed cost with a reason and a name.
`priceFor()` was widened; no second calculation was added.

### Flex and ACP

L3 keeps its id and its code so nothing referencing it moves; only its display
name narrows to Flex, and ACP becomes L5 with Sheet as its only pack unit and a
minimum set of 32 rather than the 200 SQ.FT that suits a roll. Items followed
the `material` attribute already in the catalogue. Acrylic and non-woven are
neither, and the brief covered only that separation, so they stayed on the Flex
line rather than being moved somewhere nobody asked for. **Note that the item
form disables the business-line field once an item exists, so the office cannot
reassign them from the UI.**

### Item photographs

Stored the way JMS stores product photographs on this same box, against the same
Cloudinary account: Cloudinary when `CLOUDINARY_URL` is set, local disk when it
is not. Vivaha writes under `vivaha/items/`, clear of JMS's `jms/products/`. The
credential was copied server-side from JMS's `.env` and never printed. Pictures
arrive as a data URL on a JSON body rather than multipart — the browser already
redraws a phone photograph through a canvas to shrink it, so it holds a base64
string either way, and this keeps a file-upload dependency off a server deployed
by rsync. JMS's `sharp` dependency was skipped: the browser downscales and
Cloudinary transforms by URL.

### Things deliberately not built

Promotional content needed nothing — the portal home already carried an ad slot,
new arrivals, the district's best sellers and a consumables nudge read off the
firm's own machine profile. "Only 60 available" already existed in the item
sheet; only the cart still refused outright, so the shortfall now carries the
number and the cart takes what there is.

The portal's Hindi stayed the default. English was added beside it as one small
dictionary — not a translation framework, for a few dozen strings.

### Two faults in our own runbooks

`docs/DEPLOY.md` and `docs/SAMAR_DEPLOY_2026-09-10.md` both carried a `pg_dump`
line that could never have run: `DATABASE_URL` carries `?schema=public`, which
`pg_dump` rejects outright. Both are corrected.

`packages/shared` is not an optional rsync. The API imports the pricing engine,
the permission list and the line config from it, so shipping `src/` alone leaves
the server running old rules against new callers.

### One outage, caused and fixed

Deploying the Cloudinary round I ran `npm install --omit=dev` on the VM, which
pruned `tsx` — and PM2 runs this API through `tsx` as its *interpreter*, there
being no build step. The API 502'd for about two minutes until dev dependencies
were reinstalled. `docs/DEPLOY.md` now says plainly never to use that flag.

### Open after this session

- **The new UI has never been seen in a browser.** The Chrome extension was not
  connected, so the pricing modal, the geo button, the bottom bar, the language
  toggle and the baskets tab are verified only through their APIs. Worth
  clicking through, the bottom bar especially — its CSS changed.
- `apps/web/.env` points local development at the production API. Anyone running
  `npm run dev:web` is driving the live backend from their laptop.
- Acrylic and non-woven sit on the Flex line and cannot be moved from the UI.
- One pre-existing eslint error in `apps/web/src/components/Qr.tsx`. Does not
  block the build.
- The Vercel project is still not git-connected; every frontend release needs a
  manual `vercel --prod` from the repo root.
- README "Not yet done" otherwise unchanged: server-side Excel/PDF exports,
  physical stock-count session, real camera scanning in the portal.

### The firm's own staff list, and where its bills go (`5c3a1c4`)

`/portal/staff`, owner only. The owner adds people, issues and re-issues their
logins (password shown once, `mustChangePassword` set), disables one when
somebody leaves, and ticks which numbers take the bills. A staff login sees
the list and no buttons.

Held back from the portal deliberately: **owner authority** — it is what
clears a credit-breaching order, so a portal-created login is always Staff —
and the owner's own contact row, which is the firm's registered contact. Every
action audits as `Name (CUST-xxx)` and notifies the sales executive. Cap of
ten people per firm.

`CustomerContact` gained `billsTo` and `userId`. `billsTo` is what the
share-bill dialog now sorts and defaults on, instead of `contacts[0]`; both
office paths and the portal refuse to leave a firm with no billing number.
`userId` replaces matching a contact to its login **by name** — the migration
backfills from that match, leaves ambiguous pairs unlinked, and marks every
owner as the billing number.

One bug of my own, caught in testing and worth remembering: the PATCH handler
synced the login's name from the *requested* name rather than the *written*
one, so an owner's refused self-rename still renamed their login.

### Returns as a page

Returns was the last list whose record only existed inside the row — two
buttons at the end of a line, a truncated reason, nothing about the order it
came off. `/returns/<id>` now matches items, customers, orders, jobs,
purchases and ledgers.

`GET /api/returns/:id` is new (the list endpoint was the only one). It returns
the **order line rate** behind the return, since a credit note is raised at
what the firm paid rather than at today's rate; where the returned item is not
on that order — seeded history has a couple — it comes back null and the page
shows a dash instead of a wrong number. The history comes from the audit log
rather than a table of its own: a return has three transitions in its life and
they are already written there.

### Zero errors and zero warnings (`bc07eb1`)

`eslint`, `tsc --noEmit` and `next build` are all clean on the whole web
package — note `npx eslint src` misses `next.config.ts`; run `npx eslint .`.

The long-standing `react-hooks/set-state-in-effect` error in `Qr.tsx` is gone:
the cached bitmap is now read in the render that asks for it (adjusting state
during render when value or size changes) instead of in an effect, which also
saves a second render pass on each of the fourteen codes a stock page draws.

Devanagari moved from a `<link>` to fonts.googleapis.com onto `next/font`, so
it is self-hosted with the face CSS inlined; `--dev` resolves to
`var(--font-dev)` and keeps the installed system faces behind it.

`@next/next/no-img-element` is off in `eslint.config.mjs`, in one place with
the reason: every `<img>` here is a `data:` URL, an already-sized Cloudinary
URL, or `/api/uploads` — `next/image` cannot take the first and would bill a
Vercel transform per card photograph for the rest.

### Route audit and installable apps (`8ed945d`)

Audited all 32 built routes against the nav, every internal link target and
every `/api` path the web calls. 16 nav entries and 22 link targets resolve;
118 API calls all land on a registered route. Three things were wrong:

- `/orders?open=<id>` (how older notifications deep-link) redirected with
  `router.push`, so Back bounced forward again. Items and customers already
  used `replace`.
- Seven notification links in the API still carried the query-string form.
  Now `/orders/<id>`.
- Five of the eighteen reports in the catalogue — stock position, ageing, dead
  stock, outstanding, GSTR-1 — are answered by a screen, not by a
  `/api/reports/<key>` endpoint, so their rows were inert. They now open the
  screen that answers them, and `/stock` takes `?tab=` the way `/accounts`
  already did.

Both the ERP and the shop now install as apps. They share one origin under
different scopes, so each has its own manifest (`/manifest.webmanifest`,
`/portal.webmanifest`) and the portal swaps the `<link>` on mount. `sw.js`
exists only to make them installable and to serve a Hindi offline card — it
never caches `/api`, because a stale stock figure or credit gate is worse than
an error. Icons are the VC monogram generated by
`scripts/mkicons.py` (pure-Python PNG writer; no image tooling on the build
machine), which also gives `/favicon.ico` a file at last.

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
