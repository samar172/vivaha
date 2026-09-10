# Backend deploy — 10 Sep 2026

Everything in this round is already on `main`. The frontend goes out on Vercel
by itself; the API box needs you.

**Deploy the backend first.** The new frontend calls endpoints that do not exist
on the current API (`/api/codes/*`, `/api/settings/users`, `/api/settings/backup`),
and it reads two new fields off `/api/items`. If Vercel promotes before the VM is
updated, the live site loads but Items, Inventory, Settings and Purchase all fail.
If Vercel has already auto-deployed by the time you read this, roll the Vercel
production alias back to the previous deployment, do the VM, then re-promote.

---

## 1. What changed on the server

| | |
|---|---|
| New API dependencies | **none** — `qrcode` is frontend-only, Vercel installs it |
| New migrations | 3 (below) |
| New modules | `src/modules/codes/`, `src/services/backup.ts` |
| Changed modules | `auth`, `settings`, `purchases`, `jobs`, `search`, `portal`, `services/items` |
| nginx change | **yes** — one line, see §3 |

### Migrations, in order

| Migration | What it adds |
|---|---|
| `20260910045824_user_password_lifecycle` | `User.mustChangePassword`, `User.passwordSetAt`, `User.lastLoginAt` |
| `20260910051437_item_codes` | `ItemCode` table + `CodeKind` / `CodeStatus` enums, FKs to `Item` and `Vendor` |
| `20260910053038_purchase_line_mfr_code` | `PurchaseLine.mfrCode` |

All three are additive. Every new column is nullable or has a default, so
existing rows are untouched and nobody gets locked out — `mustChangePassword`
defaults to `false`, so current logins keep working exactly as they do now.

---

## 2. Deploy

Same as `docs/DEPLOY.md`, no deviations:

```bash
# 1. Dry run
rsync -avn --delete -e ssh --exclude node_modules --exclude '.env*' \
  apps/api/src/ saangri:/opt/apps/vivaha/apps/api/src/
rsync -avn --delete -e ssh apps/api/prisma/ saangri:/opt/apps/vivaha/apps/api/prisma/

# 2. Back up first, always
# DATABASE_URL carries ?schema=public, which pg_dump rejects outright
# ("invalid URI query parameter"), so the query string is stripped first.
ssh saangri 'U=$(grep DATABASE_URL /opt/apps/vivaha/apps/api/.env | cut -d\" -f2 | sed "s/?.*//"); \
  pg_dump "$U" -F c -f /opt/apps/vivaha/backups/vivaha_$(date +%Y%m%d_%H%M%S).dump'

# 3. Sync for real
rsync -a -e ssh --exclude node_modules --exclude '.env*' apps/api/src/ saangri:/opt/apps/vivaha/apps/api/src/
rsync -a -e ssh apps/api/prisma/ saangri:/opt/apps/vivaha/apps/api/prisma/

# 4. Migrate
ssh saangri "cd /opt/apps/vivaha/apps/api && npx prisma migrate status"
ssh saangri "cd /opt/apps/vivaha/apps/api && npx prisma migrate deploy && npx prisma generate"

# 5. Restart
ssh saangri "pm2 restart vivaha-api && sleep 3 && pm2 show vivaha-api"
curl https://vivaha-api.98.70.37.83.nip.io/health
```

`packages/shared/` did **not** change this round — you can skip that rsync.

**Do not run the seed on production.** `prisma/seed.ts` truncates every table.
It changed this round (it now generates demo QR labels), which makes it more
tempting to run — don't.

---

## 3. nginx — one line, needed for restore

Settings → Backup & restore lets a Super Admin upload a full-database JSON and
restore it. Express accepts up to 128 MB on `/api/settings/restore`; nginx
defaults to **1 MB** and will reject the upload with a 413 before Express ever
sees it. The current demo backup is ~290 KB, so this will not bite immediately,
but it will as soon as there is real transaction history.

In `/etc/nginx/sites-available/vivaha-api.98.70.37.83.nip.io`, inside the
`server` block:

```nginx
client_max_body_size 128M;
```

Then:

```bash
ssh saangri "nginx -t && systemctl reload nginx"
```

Worth also confirming the proxy read timeout is generous — a restore runs the
whole rebuild inside one transaction and can take a while on a large database:

```nginx
proxy_read_timeout 300s;
```

---

## 4. New endpoints (all behind existing permissions)

| Method | Path | Permission |
|---|---|---|
| `GET` | `/api/codes/resolve?code=` | `item.view` |
| `GET` | `/api/codes/item/:itemId` | `item.view` |
| `POST` | `/api/codes/item/:itemId/manufacturer` | `item.edit` |
| `POST` | `/api/codes/item/:itemId/relabel` | `item.edit` |
| `POST` | `/api/auth/change-password` | any signed-in user |
| `GET` | `/api/settings/users` | `settings.manage` |
| `POST` | `/api/settings/users` | `settings.manage` |
| `PATCH` | `/api/settings/users/:id` | `settings.manage` |
| `POST` | `/api/settings/users/:id/reset-password` | `settings.manage` |
| `GET` | `/api/settings/backup` | `settings.manage` |
| `GET` | `/api/settings/backup/state` | `settings.manage` |
| `POST` | `/api/settings/restore` | `settings.manage` |

No new permission strings were added — the existing 26 cover all of it.

---

## 5. One behaviour change to know about

`POST /api/purchases` now **refuses a purchase invoice that mixes business
lines**. This is a fix, not a restriction for its own sake: the document stores a
single `gstPct` taken from the first line, so a mixed cards (12 %) + ink (18 %)
invoice was silently taxing half the document at the wrong rate.

If a real vendor genuinely invoices across lines, tell me and I will move
purchases to per-rate tax blocks the way sales invoices already work. Until then
it is one document per line.

---

## 6. `ItemCode` starts empty on production

The migration creates the table but does not fill it, so on first load every item
shows "still on the manufacturer's label / no code yet". Two options:

**(a) Leave it.** Staff issue codes from Items → item drawer → *Issue Vivaha
Cards code* as they work through the catalogue. Honest, and the screen is built
to show exactly which items are still pending.

**(b) Backfill own codes for the whole catalogue.** Safe, additive, touches
nothing else. Run once:

```bash
ssh saangri "cd /opt/apps/vivaha/apps/api && npx tsx -e \"
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const items = await p.item.findMany({ include: { codes: true } });
let n = 0;
for (const it of items) {
  if (it.codes.some(c => c.kind === 'OWN')) continue;
  const code = 'VC-' + (it.designNo || it.sku).replace(/[^A-Za-z0-9]+/g, '-').toUpperCase();
  if (await p.itemCode.findUnique({ where: { code } })) continue;
  await p.itemCode.create({ data: { code, itemId: it.id, kind: 'OWN', status: 'ACTIVE', by: 'Backfill' } });
  n++;
}
console.log('issued', n, 'codes');
await p.\\\$disconnect();
\""
```

This only *adds* own codes. It does not invent manufacturer codes, because we
don't know what the factory actually printed — those get recorded at goods
receipt from now on (there's a field on the GRN screen for it).

My recommendation is **(b)**, so the catalogue is scannable from day one, then
manufacturer labels accumulate naturally as stock arrives.

---

## 7. Verify after deploy

```bash
curl -s https://vivaha-api.98.70.37.83.nip.io/health

TOKEN=$(curl -s -X POST https://vivaha-api.98.70.37.83.nip.io/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"demo123","kind":"internal"}' | jq -r .accessToken)

# should be 200 and list staff + portal accounts
curl -s -H "Authorization: Bearer $TOKEN" \
  https://vivaha-api.98.70.37.83.nip.io/api/settings/users | jq '.staff | length'

# should report the live data watermark
curl -s -H "Authorization: Bearer $TOKEN" \
  https://vivaha-api.98.70.37.83.nip.io/api/settings/backup/state | jq

# items now carry code / codeKind
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://vivaha-api.98.70.37.83.nip.io/api/items?line=ALL&q=" | jq '.items[0] | {sku, code, codeKind}'
```

## 8. Rollback

Migrations are additive, so the previous API code runs fine against the new
schema — it just ignores the new columns. To roll back, rsync the previous
`src/` and `pm2 restart vivaha-api`. **Do not** roll the database back unless you
have to; if you must, restore the `pg_dump` from step 2.

---

## Open question for you

`admin` is still the only active office login, and its password is the shared
`demo123`. Now that Settings → Users & logins exists, real accounts can be
issued properly — each one gets a generated temporary password and is forced to
replace it at first sign-in.

Do you want me to leave the demo accounts as they are, or should the client's
actual staff be set up before handover? If the latter, send me the names and
roles and I'll prepare it.
