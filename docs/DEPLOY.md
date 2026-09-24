# Deployment

## Backend — Azure VM (`saangri`)

Same box as the JMS and Saangri APIs, kept fully separate from them: its own
directory, its own Postgres role and database, its own PM2 process, its own
nginx vhost and certificate. Nothing about `jms` or `saangri` was modified.

| | |
|---|---|
| Public URL | `https://vivaha-api.98.70.37.83.nip.io` |
| Path on VM | `/opt/apps/vivaha` |
| Internal port | `4004` (jms-api is 4002, saangri-api is 4000) |
| PM2 process | `vivaha-api` (fork mode, `tsx` against `src/server.ts` — no build step) |
| Database | local Postgres, db `vivaha`, owner role `vivaha` |
| nginx | `/etc/nginx/sites-available/vivaha-api.98.70.37.83.nip.io` |
| TLS | Let's Encrypt via certbot, auto-renewing, expires 2026-11-21 |

Server env lives in `/opt/apps/vivaha/apps/api/.env` (chmod 600, never in git).
`NODE_ENV=production` matters: it flips the refresh cookie to
`Secure; SameSite=None`, without which a cross-origin frontend cannot stay
signed in.

### Redeploying the backend

There is no build step, so a plain rsync of `src/` and `prisma/` is enough.

```bash
# 1. Dry run — confirm exactly what changes
rsync -avn --delete -e ssh --exclude node_modules --exclude '.env*' \
  apps/api/src/ saangri:/opt/apps/vivaha/apps/api/src/
rsync -avn --delete -e ssh apps/api/prisma/ saangri:/opt/apps/vivaha/apps/api/prisma/

# 2. Back up the database first, always.
#    DATABASE_URL carries ?schema=public and pg_dump rejects it outright
#    ("invalid URI query parameter"), so the query string is stripped first.
ssh saangri 'U=$(grep DATABASE_URL /opt/apps/vivaha/apps/api/.env | cut -d\" -f2 | sed "s/?.*//"); \
  pg_dump "$U" -F c -f /opt/apps/vivaha/backups/vivaha_$(date +%Y%m%d_%H%M%S).dump'

# 3. Sync for real. packages/shared is NOT optional whenever it changed:
#    the API imports the pricing engine, the permission list and the line
#    config from it, so shipping src/ alone leaves the server running old
#    rules against new callers. Check with:
#      git diff --name-only <last deployed>..HEAD -- packages/shared
rsync -a -e ssh --exclude node_modules --exclude '.env*' apps/api/src/ saangri:/opt/apps/vivaha/apps/api/src/
rsync -a -e ssh apps/api/prisma/ saangri:/opt/apps/vivaha/apps/api/prisma/
rsync -a -e ssh --exclude node_modules packages/shared/ saangri:/opt/apps/vivaha/packages/shared/

# 4. Migrate (check first; deploy is non-interactive and prod-safe)
ssh saangri "cd /opt/apps/vivaha/apps/api && npx prisma migrate status"
ssh saangri "cd /opt/apps/vivaha/apps/api && npx prisma migrate deploy && npx prisma generate"

# 5. Restart and verify
ssh saangri "pm2 restart vivaha-api && sleep 3 && pm2 show vivaha-api"
curl https://vivaha-api.98.70.37.83.nip.io/health
```

### If a deploy adds a dependency

Run `npm install` at `/opt/apps/vivaha` — **plain, never `--omit=dev`**. PM2 runs
this API through `tsx` as its *interpreter* (there is no build step), and `tsx`
is a devDependency: pruning dev packages deletes the interpreter and the API
stops booting with a 502 until they are reinstalled. Learned on 11 Sep 2026, the
hard way, with about two minutes of downtime.

```bash
ssh saangri "cd /opt/apps/vivaha && npm install"
ssh saangri "ls /opt/apps/vivaha/node_modules/.bin/tsx"   # must exist before restarting
```

Reseeding wipes and rebuilds the demo dataset — only run it deliberately:

```bash
ssh saangri "cd /opt/apps/vivaha/apps/api && npx tsx prisma/seed.ts"
```

## Frontend — Vercel

Import the repo, then set these in the Vercel project:

- **Root Directory**: `apps/web`
- **Environment variable**: `API_PROXY_TARGET = https://vivaha-api.98.70.37.83.nip.io`

`next.config.ts` rewrites `/api/*` to `API_PROXY_TARGET`, so the browser only
ever talks to the Vercel origin. That keeps the refresh cookie first-party,
which matters because Safari and Brave block third-party cookies by default —
with direct cross-origin calls the session would silently die when the 30-minute
access token expired.

Do **not** set `NEXT_PUBLIC_API_URL`. It makes the browser call the API host
directly, which is the third-party-cookie path described above. It exists for
local experiments only.

Deploy to a preview first (plain `vercel`), check it, then promote to production.

### If you do point a browser straight at the API host

`CORS_ORIGIN` in the server `.env` holds the allowed origins as a comma list,
and `VERCEL_PREVIEW_SUFFIX` additionally permits this project's own preview
hosts — set it to the suffix Vercel gives them, which carries the team slug
(e.g. `-samarbhati251-5760s-projects.vercel.app`). It replaced an earlier
`ALLOW_VERCEL_ORIGINS=true`, which allowed **any** `*.vercel.app` origin: those
are free to register, and with credentials allowed and the refresh cookie set
`SameSite=None`, such a page could call `/api/auth/refresh` on a signed-in
visitor's behalf and read back a live access token. Leave it unset and no
preview origin is allowed, which is the right default for production.
host so per-deployment preview URLs work without editing the server each time.
After changing either, `ssh saangri "pm2 restart vivaha-api"`.

## Demo credentials

Office: `admin` / `demo123`.
Portal: `sharma_wedding`, `rajputana_cards`, `golden_invites` — all `demo123`.
