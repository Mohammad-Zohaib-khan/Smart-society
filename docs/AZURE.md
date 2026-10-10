# Deploying to Azure

Target: **Azure Container Apps** (two containers) + **MongoDB** + **Azure Files** for uploads.
`deploy/azure/deploy.sh` does all of the Azure steps; this page explains the choices and the
things you must decide yourself.

```
Browser ─HTTPS─> web (nginx, external ingress, managed TLS) ─/api─> api (Node, internal ingress) ─> MongoDB
                                                                      └─ Azure Files share (/data/uploads)
```

The web container serves the SPA and proxies `/api` to the API on the **same origin**, so session
cookies stay first-party. The API has no public endpoint.

## 1. Database — choose a MongoDB-compatible service

The API needs real MongoDB semantics: it creates **unique partial indexes** at start-up
(`apps/api/src/models/index.ts`) and relies on them to prevent double bookings and to keep parking
assignments consistent.

| Option | Use it? |
|---|---|
| **MongoDB Atlas** (choose Azure as the cloud provider and the same region) | ✅ Recommended. Fully compatible, has a free tier. |
| **Azure Cosmos DB for MongoDB (vCore)** | ⚠️ Possible. Before going live, run the API test suite against it: `TEST_DB=uri TEST_MONGODB_URI="<conn string>" npm test -w apps/api` (use a throwaway database). |
| Azure Cosmos DB for MongoDB (**RU**) | ❌ Does not support unique partial indexes — the API will fail to start or lose integrity guarantees. |

In Atlas, allow network access from Azure (Container Apps outbound IPs, or 0.0.0.0/0 with a strong
password) and create a database user. Use the `mongodb+srv://…/smartsociety` connection string.

## 2. Deploy

Prerequisites: [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), `az login`,
and bash (Git Bash on Windows works). Local Docker is **not** needed — images are built by
`az acr build`.

```bash
export MONGODB_URI='mongodb+srv://USER:PASS@cluster.xxxxx.mongodb.net/smartsociety'
export LOCATION=centralindia        # optional; must be a region your subscription allows
export LOCAL_BUILD=1                # optional: build with local Docker (needed on Azure for Students)
bash deploy/azure/deploy.sh
```

Optional variables: `PREFIX` (resource-name prefix), `RG`, `API_CPU`/`API_MEMORY` (default 1.0 / 2Gi; 0.5 / 1Gi is a valid smaller pair), `WEB_URL` (when using a custom
domain), and email: `EMAIL_PROVIDER=smtp SMTP_HOST=… SMTP_PORT=587 SMTP_USER=… SMTP_PASS=…
EMAIL_FROM='Smart Society <no-reply@yourdomain>'` (e.g. Azure Communication Services SMTP or any
SMTP provider). Without email, invitations still work through a shareable link.

The script creates: resource group, Container Registry, Container Apps environment (with Log
Analytics), a Storage account + `uploads` file share, and the `-api` and `-web` container apps.
Re-running it builds new images and rolls out a new revision.

## 3. First sign-in

```bash
az containerapp exec -n smartsociety-api -g smartsociety-rg --command sh
# inside the container:
PLATFORM_ADMIN_PASSWORD='a-long-unique-password' node dist/scripts/create-platform-admin.js you@example.com "Your Name"
```

Open the web URL printed by the script, sign in, then **Platform → Onboard a society**.
Do **not** run the demo seed in production (it refuses to run with `NODE_ENV=production`).

## Sizing and limits (why the script sets what it sets)

* **API: exactly 1 replica, 1 vCPU / 2 GiB.** Rate limits are stored in memory per process, so
  several replicas would multiply the limits. Password hashing (scrypt, OWASP cost) uses ~128 MiB
  per concurrent sign-in. To scale out, first move rate limiting to a shared store (e.g. Azure Cache
  for Redis with `rate-limit-redis`).
* **Web: 1–3 replicas, 0.25 vCPU / 0.5 GiB.** Stateless nginx.
* **`TRUST_PROXY=3`** — client → web ingress → nginx → API ingress → API. After deploying, check
  that the audit log (**Audit** page) shows your real public IP; if it shows a 10.x/100.x address,
  adjust this value.
* **Uploads** go to the Azure Files share mounted at `/data/uploads` (owned by uid 1000, the
  non-root `node` user in the image). Back up the share along with the database.
* **HTTPS** is provided by Container Apps' managed certificate on `*.azurecontainerapps.io` or your
  custom domain; cookies use the `__Host-` prefix and `Secure`, and nginx sends HSTS.

## Custom domain

Add it to the **web** app (`az containerapp hostname add` + `bind`, managed certificate), then re-run
the script with `WEB_URL=https://your.domain` so the API's `WEB_ORIGIN`/`APP_URL` (CORS and email
links) match.

## Hardening you may want later

* Pull images with a managed identity instead of ACR admin credentials.
* Keep `MONGODB_URI`/`SMTP_PASS` in Key Vault and reference them as Key Vault secrets.
* Restrict Atlas network access to the environment's static outbound IP (workload-profile environment).
* No cron job is needed for visitor-data retention: the API purges expired records every 6 hours.

## Test the same images locally

```bash
cp .env.example .env     # set NODE_ENV=production, EMAIL_PROVIDER=none
docker compose up --build          # http://localhost:8080
docker compose exec -e NODE_ENV=development api node dist/scripts/seed.js   # demo data (local only)
```
