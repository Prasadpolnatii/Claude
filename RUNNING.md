# Running the AI Operations Dashboard locally

Exact, copy-paste setup to run the dashboard on your machine. No cloud
accounts and no API keys are required — it runs in **mock LLM mode** by default.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | ≥ 20 | `node -v` to check |
| **npm** | ≥ 9 | ships with Node 20 |
| **Docker** + Docker Compose | any recent | only used to run MongoDB + Redis. No Docker? See [§6](#6-no-docker-run-mongo--redis-another-way). |

The stack: **MongoDB** (data), **Redis** (job queue + rate limits + budgets),
an **Express API** (`:4000`), and a **Vite/React web app** (`:5173`).

---

## 2. Get the code

```bash
git clone https://github.com/Prasadpolnatii/ai-operations-copilot.git
cd ai-operations-copilot
git checkout claude/wonderful-allen-6iza46
```

## 3. Configure environment

Copy the example env. The defaults are fine for local dev (mock LLM, local
Mongo/Redis):

```bash
cp .env.example .env
```

What matters in `.env`:

- `LLM_MODE=mock` — runs the full flow with **no OpenAI key and no spend**.
  (Set `LLM_MODE=openai` + `OPENAI_API_KEY=...` only if you want live AI for the
  SOP-answer / RCA features. The dashboard itself needs neither.)
- `JWT_SECRET` — the shipped value is a dev placeholder; the app **warns** but
  runs. For anything beyond local play, set a unique 32+ char secret.
- `MONGODB_URI=mongodb://localhost:27017/ops_copilot` and
  `REDIS_URL=redis://localhost:6379` — match the Docker services below.
- `ALERTS_SIMULATE=true` — emits synthetic alerts so the **real-time Alerts**
  feed is live out of the box (set `false` to silence it).

## 4. Start MongoDB + Redis

```bash
docker compose up -d        # starts mongo:7 (27017) and redis:7 (6379)
docker compose ps           # both should be "running"/healthy
```

## 5. Install, seed, run

```bash
npm install                 # installs all workspaces (api, web, shared)
npm run seed                # loads demo data; PRINTS two dev JWTs (admin + engineer)
npm run dev                 # starts API (:4000) and web (:5173) together
```

Then:

1. Open **http://localhost:5173**.
2. Paste one of the JWTs printed by `npm run seed` into the token box:
   - **admin** token → full access, including the **Audit** log.
   - **engineer** token → everything except Audit (you'll get a 403 there — RBAC working as intended).
3. You're in. Toggle dark/light from the top bar.

> The seed populates 3 incidents, 6 applications, 5 alerts, 4 queues, and 3
> knowledge articles for the `demo-tenant`. Re-run `npm run seed` any time to
> reset to a clean demo state. Dev JWTs are valid for 12 hours.

### Optional: background worker (for the AI features)

The **dashboard** pages need only the API + web above. The two **generative**
features — *SOP grounded answer* and *RCA generation* — run as async jobs on a
worker. To use them, start the worker in a second terminal:

```bash
npm run worker
```

---

## 6. No Docker? Run Mongo + Redis another way

You only need something listening on `27017` (MongoDB wire protocol) and `6379`
(Redis). Any of these works:

**a) Local installs**

```bash
# macOS (Homebrew)
brew install mongodb-community redis
brew services start mongodb-community
brew services start redis
```

**b) FerretDB (MongoDB-compatible, single binary, SQLite backend)** — handy when
you can't install `mongod`. Download the `ferretdb-linux-amd64` (or your
platform) binary from <https://github.com/FerretDB/FerretDB/releases> (v1.x),
then:

```bash
mkdir -p /tmp/ferret
FERRETDB_TELEMETRY=disable ./ferretdb \
  --handler=sqlite \
  --sqlite-url=file:/tmp/ferret/ \
  --listen-addr=127.0.0.1:27017 &
# Redis still required:
redis-server --daemonize yes
```

Either way, keep `MONGODB_URI` / `REDIS_URL` in `.env` pointing at
`localhost:27017` / `localhost:6379`, then continue from [§5](#5-install-seed-run).

> Note: FerretDB does not implement Atlas `$vectorSearch`, so the *SOP grounded
> answer* feature won't work against it. The dashboard, incidents, alerts,
> health, queues, knowledge, and audit pages all work fine.

---

## 7. Useful scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | API + web together (hot reload) |
| `npm run dev:api` / `npm run dev:web` | run one side only |
| `npm run worker` | background job worker (SOP answer / RCA) |
| `npm run seed` | reset demo data + print dev JWTs |
| `npm run typecheck` | type-check all workspaces |
| `npm test` | API unit + integration tests |

---

## 8. Ports

| Service | URL |
|---------|-----|
| Web app | http://localhost:5173 |
| API | http://localhost:4000 (health: `/api/health`) |
| MongoDB | localhost:27017 |
| Redis | localhost:6379 |

The web dev server proxies `/api` → `http://localhost:4000`, so the browser only
ever talks to `:5173`.

---

## 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| API exits on boot: `JWT_SECRET ... at least 16 chars` | Set `JWT_SECRET` in `.env` (≥ 16 chars). |
| Dashboard pages show **503 `db_unavailable`** | MongoDB isn't reachable. `docker compose ps`; confirm `MONGODB_URI`. The API intentionally boots without Mongo (health + jobs still work). |
| Alerts feed shows **offline** | Check the API is up; `ALERTS_SIMULATE=true` for synthetic alerts; the SSE stream needs the API reachable at `:4000`. |
| `401 unauthorized` in the UI | Token missing/expired — re-run `npm run seed` and paste a fresh JWT. |
| `403` on the **Audit** page | Expected with an engineer token. Use the admin token. |
| Port already in use | Stop the other process, or change `API_PORT` / Vite `server.port`. |
| SOP grounded answer / RCA never completes | Start the worker: `npm run worker`. |

---

## 10. Quick reference (TL;DR)

```bash
git checkout claude/wonderful-allen-6iza46
cp .env.example .env
docker compose up -d
npm install
npm run seed        # copy the admin JWT it prints
npm run dev         # open http://localhost:5173, paste the JWT
```
