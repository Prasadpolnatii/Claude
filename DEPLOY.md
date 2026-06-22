# Deploying the AI Operations Dashboard (public URL)

This app deploys as **one service** that serves the API + the built React SPA
(same origin) and runs the BullMQ worker in-process, plus a managed **Redis** and
an external **MongoDB Atlas** database. It's been made production-ready and the
config is committed (`render.yaml`).

## Why not Vercel?

Vercel is serverless (short-lived functions, no always-on process). This backend
needs a **long-running Express server**, a **BullMQ worker**, **Server-Sent
Events** (live alerts), and **persistent Redis/Mongo connections** — none of
which fit Vercel's model. **Render** (used below) and **Railway** run
long-running services and are the right fit. The result is a public
`https://…onrender.com` URL you can open from your phone.

---

## Option A — Render (recommended, has a free tier)

You'll need a (free) **Render** account and a (free) **MongoDB Atlas** account.
No terminal commands — it's all dashboard.

### 1. Create a free MongoDB Atlas database

1. <https://www.mongodb.com/cloud/atlas/register> → create a free **M0** cluster.
2. **Database Access** → add a database user (username + password).
3. **Network Access** → Add IP → `0.0.0.0/0` (allow from anywhere — Render's
   egress IPs aren't fixed on the free tier).
4. **Connect → Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/ops_copilot?retryWrites=true&w=majority
   ```
   Make sure the database name `ops_copilot` is in the path (add it before `?`).

### 2. Deploy on Render from the Blueprint

1. <https://dashboard.render.com> → **New** → **Blueprint**.
2. Connect this GitHub repo and pick the branch
   (`claude/wonderful-allen-6iza46`, or your default branch after merge).
   Render reads **`render.yaml`** and shows two resources: a web service
   (`ai-ops-dashboard`) and a Key Value/Redis instance (`ai-ops-redis`).
3. When prompted for the **`MONGODB_URI`** secret, paste the Atlas string from
   step 1. (`JWT_SECRET` is auto-generated; `REDIS_URL` is wired automatically.)
4. **Apply**. Render builds (`npm install && npm run build:web`) and starts
   (`npm run seed; npm run start`).

### 3. Open it

When the web service goes live, its URL is shown at the top, e.g.
`https://ai-ops-dashboard.onrender.com`. Open it on your phone and tap
**“Enter demo as Admin.”** That's it.

> **Free-tier notes**
> - The free instance **sleeps when idle**; the first request after a nap takes
>   ~30–60s to wake. Subsequent requests are fast.
> - Demo data is **reseeded on every restart** (the `npm run seed` in
>   `startCommand`) — handy for a clean demo, but any edits reset on cold start.
>   Remove `npm run seed;` from the start command if you want persistence.
> - **Security:** `ENABLE_DEV_LOGIN=true` hands out admin tokens to anyone with
>   the URL — fine for a demo, **never** for real multi-user use. Set it to
>   `false` (and rely on pasted seed JWTs) to lock it down.

### If the Blueprint validator complains

Render occasionally renames Blueprint keys. If validation errors on a field,
adjust in the editor and re-apply:
- `runtime: node` ↔ `env: node`
- Redis `type: keyvalue` ↔ `type: redis` (and `property: connectionString`)

---

## Option B — Railway (no separate Atlas needed)

Railway has first-class **MongoDB** and **Redis** plugins, so everything lives in
one project.

1. <https://railway.app> → **New Project** → **Deploy from GitHub repo** → pick this repo/branch.
2. Add plugins: **+ New → Database → MongoDB**, and **+ New → Database → Redis**.
3. On the app service, set **Variables**:
   - `SERVE_WEB=true`, `INLINE_WORKER=true`, `ENABLE_DEV_LOGIN=true`,
     `ALERTS_SIMULATE=true`, `LLM_MODE=mock`, `WEB_ORIGIN=*`, `NODE_ENV=production`
   - `JWT_SECRET=<any 32+ random chars>`
   - `MONGODB_URI=${{ MongoDB.MONGO_URL }}` (reference the plugin var; append `/ops_copilot` if absent)
   - `REDIS_URL=${{ Redis.REDIS_URL }}`
4. Set **Build** = `npm install && npm run build:web`, **Start** =
   `npm run seed; npm run start`. Railway injects `PORT` automatically (the app
   honors it).
5. Generate a public domain (service → **Settings → Networking → Generate
   Domain**) and open it on your phone.

---

## Environment variables (reference)

| Var | Deploy value | Purpose |
|-----|--------------|---------|
| `PORT` | injected by host | bind port (app reads it automatically) |
| `NODE_ENV` | `production` | enables prod behavior |
| `SERVE_WEB` | `true` | API serves the built SPA (single origin) |
| `INLINE_WORKER` | `true` | run BullMQ worker in the API process |
| `ENABLE_DEV_LOGIN` | `true` (demo) / `false` (locked) | one-tap demo login |
| `JWT_SECRET` | 32+ random chars (Render auto-generates) | token signing |
| `MONGODB_URI` | Atlas / plugin URI | database |
| `REDIS_URL` | managed Redis URI | queue / rate limits |
| `LLM_MODE` | `mock` | no LLM key needed; set `openai` + `OPENAI_API_KEY` for live AI |
| `ALERTS_SIMULATE` | `true` | live synthetic alerts feed |
| `WEB_ORIGIN` | `*` | CORS (SPA is same-origin, so permissive is fine) |

---

## What's already done in this repo

- `render.yaml` Blueprint (web service + Redis; Mongo via Atlas).
- API serves the built SPA + SPA deep-link fallback in production (`SERVE_WEB`).
- In-process worker (`INLINE_WORKER`) so one free instance runs everything.
- Binds to `$PORT`; `start` / `start:worker` / `build:web` scripts added.
- Gated demo login (`/api/auth/dev-login`) + one-tap buttons on the login screen.

Verified locally in production mode: `$PORT` binding, SPA serving + fallback,
demo-login issuing a working admin token, in-process worker, and live dashboard
data — see the commit for details.
