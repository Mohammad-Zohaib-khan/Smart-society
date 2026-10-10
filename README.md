# Smart Society

A role-based platform for running a residential society: visitors at the gate, complaints and
maintenance work orders, amenity bookings, vehicles and parking, notices, notifications, reports
and an audit log — for **residents, security guards, maintenance staff, the society office
(admin), committee members** and an optional **platform admin** who onboards societies.

Stack: React 19 · Vite 8 · TypeScript (strict) · Tailwind CSS 4 · TanStack Query · React Router 7 ·
Node 22 · Express 5 · MongoDB (Mongoose 8) · Zod 4 shared between client and server.
Visual layer: Botanical / Organic Serif design system (Playfair Display + Source Sans 3, self-hosted),
WebGL `CloudShader` hero, `@shadergradient/react` water-plane atmosphere, Lenis smooth scrolling.

> **Status:** all tests pass against a real MongoDB, and the app runs on Azure Container Apps —
> see `docs/AZURE.md` for the deployment guide.

## Quick start (local development)

Requirements: **Node 20.19+ or 22.12+**, npm 10+, and **MongoDB 6+** (local `mongod`, Docker
`mongo:7`, or a free MongoDB Atlas cluster).

```bash
npm install                      # npm 11 recommended (see "Troubleshooting")
cp .env.example apps/api/.env    # set MONGODB_URI; EMAIL_PROVIDER=console is handy in development
npm run seed                     # demo society + accounts (development only, idempotent)
npm run dev                      # API on :4000, web on :5173 (proxies /api)
```

Open <http://localhost:5173>. Demo accounts (password `demo-pass-2026`, or `SEED_DEMO_PASSWORD`):

| Role | Email |
|---|---|
| Society admin | `admin@demo.smartsociety.invalid` |
| Committee | `committee@demo.smartsociety.invalid` |
| Security guard | `guard@demo.smartsociety.invalid`, `guard2@…` |
| Residents | `resident@…` (W-302), `resident2@…` (W-501), `resident3@…` (C-204), `resident4@…` (C-401), `resident5@…` (W-302) |
| Maintenance staff | `staff@…`, `staff2@…` |
| Platform admin | `platform@demo.smartsociety.invalid` |

All demo data is fictional and labelled "(Demo)". `npm run seed -- --reset` deletes and recreates
**only** the demo society and the `@demo.smartsociety.invalid` accounts. The seed refuses to run with
`NODE_ENV=production`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + web (Vite) |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` | ESLint (typescript-eslint strict, react-hooks) |
| `npm test` | Unit tests (shared, web) and API integration tests against a **real mongod** started by `mongodb-memory-server` (downloads MongoDB on first run) |
| `TEST_DB=uri TEST_MONGODB_URI=mongodb://… npm test -w apps/api` | API tests against your own MongoDB |
| `npm run test:api:double` | API tests against the in-process wire-protocol test double (for machines that can't download MongoDB) |
| `npm run build` | API bundle (`apps/api/dist`) + web bundle (`apps/web/dist`) |
| `npm run verify` | typecheck + lint + tests + build |
| `npm run e2e` | Browser journeys for every role (see `e2e/journeys.mjs` for prerequisites; needs `npm i --no-save puppeteer`) |
| `npm run seed` / `npm run purge-visitors` | Demo data / apply visitor-data retention now |
| `npm run create-platform-admin -- <email> "<name>"` | Create or promote the platform admin (password from `PLATFORM_ADMIN_PASSWORD`) |

## Configuration

All API settings are environment variables, validated at start-up — see `.env.example`
(placeholders only). Highlights:

* `MONGODB_URI` — **required**.
* `WEB_ORIGIN`, `APP_URL` — CORS allow-list and the base URL used in invitation/reset links.
* `EMAIL_PROVIDER` — `none` (default), `console` (dev: emails printed to the API log), or `smtp`
  with `SMTP_*` and `EMAIL_FROM`. **Without email**, invitations still work: the admin is shown a
  private link to share; password reset by email is unavailable and the UI says so.
* `UPLOAD_DIR` — where complaint photos/PDFs are stored; use a persistent volume.
* Not included in this version (shown as "not set up" in the app): SMS, WhatsApp, push, payments, AI.

Web (`apps/web/.env.example`): normally nothing to set — the app calls `/api` on its own origin.

## Deployment

The recommended topology serves the web app and API **on the same origin** (`/` static, `/api`
proxied), so cookies stay first-party:

```
Browser ── HTTPS ──> nginx (deploy/nginx.conf.template: SPA + security headers + /api proxy) ──> API :4000 ──> MongoDB
```

* **Docker:** `apps/api/Dockerfile`, `apps/web/Dockerfile` (nginx), and `docker-compose.yml`
  (mongo + api + web on :8080). `cp .env.example .env`, edit, `docker compose up --build`.
  The web image reads `API_UPSTREAM` (where nginx proxies `/api`; default `http://api:4000`).
  Verified: images build, the stack starts healthy, and sign-in works end to end.
* **Azure:** see `docs/AZURE.md` and `deploy/azure/deploy.sh` (Container Apps + Azure Files + MongoDB Atlas).
* **Without Docker:** `npm ci && npm run build`; run `node apps/api/dist/server.js` (with env vars,
  `NODE_ENV=production`) behind a reverse proxy; serve `apps/web/dist` as static files with SPA
  fallback to `index.html`, using the headers in `deploy/nginx.conf.template`.
* Production requirements enforced at start-up: `COOKIE_SECURE=true` (default in production),
  rate limiting on, no console email. Set `TRUST_PROXY` to the number of proxies in front.
* MongoDB: any 6+ deployment with full index support (unique partial indexes); indexes are created
  on start-up. Back it up. Azure Cosmos DB for MongoDB (RU) is **not** compatible.
* After deploying, create the first platform admin
  (`PLATFORM_ADMIN_PASSWORD='…' npm run create-platform-admin -- you@example.com "Your Name"`, or
  `node apps/api/dist/scripts/create-platform-admin.js …` in production), sign in, then
  **Platform → Onboard a society** and send the society admin their invitation.

## Project documents

* `ARCHITECTURE.md` — modules, request flow, authorization, concurrency, front-end layers
* `SECURITY.md` — threat model, controls, residual risks
* `docs/API.md` — endpoint reference
* `docs/AZURE.md` — deploying to Azure Container Apps

## Troubleshooting

* **`npm install` fails with "Cannot read properties of null (reading 'edgesOut')"** — an npm 10
  resolver bug triggered by Vitest 4's optional peers. Use npm 11: `npx -y npm@11 install`
  (`npm ci` from the committed lockfile is unaffected).
* **API tests hang on first run** — `mongodb-memory-server` is downloading MongoDB (~100 MB). Behind
  a proxy that blocks `fastdl.mongodb.org`, use `TEST_DB=uri` or `npm run test:api:double`.
* **Sign-in works but every action says the security token is stale** — the API and web are on
  different *sites*; serve them same-origin or same-site (see `apps/web/.env.example`).
