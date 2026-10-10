#!/usr/bin/env bash
# Deploys Smart Society to Azure Container Apps. See docs/AZURE.md first.
#
#   Browser ─HTTPS─> [web: nginx, external ingress] ─/api─> [api: Node, internal ingress] ─> MongoDB
#                                                                  └─ Azure Files share for uploads
#
# Requirements: Azure CLI (az login done), run from the repository root in bash (Git Bash is fine).
# Images are built in the cloud with `az acr build`, so local Docker is not needed.
#
# Usage:
#   export MONGODB_URI='mongodb+srv://user:pass@cluster.example.mongodb.net/smartsociety'
#   bash deploy/azure/deploy.sh
# Re-running is safe: it rebuilds the images and rolls out a new revision.
set -euo pipefail

: "${MONGODB_URI:?Set MONGODB_URI (MongoDB Atlas or Cosmos DB for MongoDB vCore; see docs/AZURE.md)}"

PREFIX="${PREFIX:-smartsociety}"
LOCATION="${LOCATION:-centralindia}"
RG="${RG:-${PREFIX}-rg}"
ACR="${ACR:-${PREFIX}acr$(echo -n "$RG" | md5sum | cut -c1-6)}"   # must be globally unique
ENV_NAME="${ENV_NAME:-${PREFIX}-env}"
API_APP="${API_APP:-${PREFIX}-api}"
WEB_APP="${WEB_APP:-${PREFIX}-web}"
STORAGE="${STORAGE:-${PREFIX}st$(echo -n "$RG" | md5sum | cut -c1-8)}"
SHARE="uploads"
TAG="${TAG:-$(date +%Y%m%d%H%M%S)}"
EMAIL_PROVIDER="${EMAIL_PROVIDER:-none}"

# Git Bash on Windows would otherwise rewrite arguments that look like paths (e.g. /data/uploads).
export MSYS_NO_PATHCONV=1

echo "==> Providers and extension"
az extension add --name containerapp --upgrade --only-show-errors
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.Storage --wait
az provider register --namespace Microsoft.ContainerRegistry --wait

echo "==> Resource group, registry"
az group create -n "$RG" -l "$LOCATION" -o none
az acr show -n "$ACR" -g "$RG" -o none 2>/dev/null || az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled true -o none
ACR_SERVER=$(az acr show -n "$ACR" -g "$RG" --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n "$ACR" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)

if [ "${LOCAL_BUILD:-0}" = "1" ]; then
  # For subscriptions where ACR Tasks are unavailable (e.g. Azure for Students): build with local Docker.
  echo "==> Building images locally and pushing to $ACR_SERVER (tag $TAG)"
  echo "$ACR_PASS" | docker login "$ACR_SERVER" -u "$ACR_USER" --password-stdin
  docker build --platform linux/amd64 -t "$ACR_SERVER/smart-society-api:$TAG" -f apps/api/Dockerfile .
  docker build --platform linux/amd64 -t "$ACR_SERVER/smart-society-web:$TAG" -f apps/web/Dockerfile .
  docker push "$ACR_SERVER/smart-society-api:$TAG"
  docker push "$ACR_SERVER/smart-society-web:$TAG"
else
  echo "==> Building images in ACR (tag $TAG)"
  az acr build -r "$ACR" -t "smart-society-api:$TAG" -f apps/api/Dockerfile . --only-show-errors
  az acr build -r "$ACR" -t "smart-society-web:$TAG" -f apps/web/Dockerfile . --only-show-errors
fi

echo "==> Container Apps environment"
az containerapp env show -n "$ENV_NAME" -g "$RG" -o none 2>/dev/null || az containerapp env create -n "$ENV_NAME" -g "$RG" -l "$LOCATION" --environment-mode WorkloadProfiles -o none
# Express environments (the CLI default in recent versions) cannot mount Azure Files.
if [ "$(az containerapp env show -n "$ENV_NAME" -g "$RG" --query properties.environmentMode -o tsv)" = "Express" ]; then
  echo "Environment $ENV_NAME is in Express mode, which cannot mount the uploads share. Delete it or set ENV_NAME." >&2
  exit 1
fi
ENV_ID=$(az containerapp env show -n "$ENV_NAME" -g "$RG" --query id -o tsv)
ENV_DOMAIN=$(az containerapp env show -n "$ENV_NAME" -g "$RG" --query properties.defaultDomain -o tsv)
WEB_URL="${WEB_URL:-https://${WEB_APP}.${ENV_DOMAIN}}"   # set WEB_URL when using a custom domain

echo "==> Azure Files share for complaint uploads"
az storage account show -n "$STORAGE" -g "$RG" -o none 2>/dev/null || \
  az storage account create -n "$STORAGE" -g "$RG" -l "$LOCATION" --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false -o none
STORAGE_KEY=$(az storage account keys list -n "$STORAGE" -g "$RG" --query '[0].value' -o tsv)
az storage share-rm create --storage-account "$STORAGE" -g "$RG" -n "$SHARE" --quota 10 -o none 2>/dev/null || true
az containerapp env storage set -n "$ENV_NAME" -g "$RG" --storage-name uploads \
  --azure-file-account-name "$STORAGE" --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name "$SHARE" --access-mode ReadWrite -o none

# YAML-escape a value for a double-quoted scalar.
q() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

API_YAML=$(mktemp)
trap 'rm -f "$API_YAML"' EXIT   # it contains secrets
cat > "$API_YAML" <<YAML
location: $LOCATION
name: $API_APP
type: Microsoft.App/containerApps
properties:
  managedEnvironmentId: $ENV_ID
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: false          # reachable only from inside the environment (the web app)
      targetPort: 4000
      transport: http
      allowInsecure: true      # plain HTTP between web and api inside the environment
    registries:
      - server: $ACR_SERVER
        username: $ACR_USER
        passwordSecretRef: acr-password
    secrets:
      - name: acr-password
        value: $(q "$ACR_PASS")
      - name: mongodb-uri
        value: $(q "$MONGODB_URI")
      - name: smtp-pass
        value: $(q "${SMTP_PASS:-unused}")
  template:
    containers:
      - name: api
        image: $ACR_SERVER/smart-society-api:$TAG
        resources: { cpu: ${API_CPU:-1.0}, memory: ${API_MEMORY:-2Gi} }   # scrypt hashing uses ~128 MiB per sign-in
        env:
          - { name: NODE_ENV, value: production }
          - { name: PORT, value: "4000" }
          - { name: MONGODB_URI, secretRef: mongodb-uri }
          - { name: WEB_ORIGIN, value: $(q "$WEB_URL") }
          - { name: APP_URL, value: $(q "$WEB_URL") }
          - { name: COOKIE_SECURE, value: "true" }
          # client -> web ingress (Envoy) -> nginx -> api ingress (Envoy) -> API
          - { name: TRUST_PROXY, value: "3" }
          - { name: UPLOAD_DIR, value: /data/uploads }
          - { name: LOG_LEVEL, value: info }
          - { name: EMAIL_PROVIDER, value: $(q "$EMAIL_PROVIDER") }
          - { name: SMTP_HOST, value: $(q "${SMTP_HOST:-}") }
          - { name: SMTP_PORT, value: $(q "${SMTP_PORT:-587}") }
          - { name: SMTP_SECURE, value: $(q "${SMTP_SECURE:-false}") }
          - { name: SMTP_USER, value: $(q "${SMTP_USER:-}") }
          - { name: SMTP_PASS, secretRef: smtp-pass }
          - { name: EMAIL_FROM, value: $(q "${EMAIL_FROM:-}") }
        probes:
          - type: Startup
            httpGet: { path: /api/health, port: 4000 }
            periodSeconds: 5
            failureThreshold: 24
          - type: Liveness
            httpGet: { path: /api/health, port: 4000 }
            periodSeconds: 30
          - type: Readiness
            httpGet: { path: /api/health, port: 4000 }
            periodSeconds: 10
        volumeMounts:
          - { volumeName: uploads, mountPath: /data/uploads }
    scale:
      # Rate limits are kept in memory, so run exactly one API replica (see docs/AZURE.md).
      minReplicas: 1
      maxReplicas: 1
    volumes:
      - name: uploads
        storageType: AzureFile
        storageName: uploads
        # The API runs as the non-root "node" user (uid/gid 1000).
        mountOptions: "uid=1000,gid=1000,dir_mode=0770,file_mode=0660"
YAML

echo "==> API app ($API_APP)"
# On Windows (Git Bash) az.exe needs a Windows path to the YAML file.
API_YAML_ARG=$(cygpath -m "$API_YAML" 2>/dev/null || echo "$API_YAML")
if az containerapp show -n "$API_APP" -g "$RG" -o none 2>/dev/null; then
  az containerapp update -n "$API_APP" -g "$RG" --yaml "$API_YAML_ARG" -o none
else
  az containerapp create -n "$API_APP" -g "$RG" --yaml "$API_YAML_ARG" -o none
fi
rm -f "$API_YAML"

echo "==> Web app ($WEB_APP)"
if az containerapp show -n "$WEB_APP" -g "$RG" -o none 2>/dev/null; then
  az containerapp update -n "$WEB_APP" -g "$RG" --image "$ACR_SERVER/smart-society-web:$TAG" \
    --set-env-vars "API_UPSTREAM=http://$API_APP" -o none
else
  az containerapp create -n "$WEB_APP" -g "$RG" --environment "$ENV_NAME" \
    --image "$ACR_SERVER/smart-society-web:$TAG" \
    --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
    --ingress external --target-port 80 \
    --env-vars "API_UPSTREAM=http://$API_APP" \
    --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 3 -o none
fi

echo
echo "Deployed: $WEB_URL"
echo "Health:   $WEB_URL/api/health"
echo
echo "Create the first platform admin (choose a strong password):"
echo "  az containerapp exec -n $API_APP -g $RG --command \"sh\""
echo "  then inside the container:"
echo "  PLATFORM_ADMIN_PASSWORD='...' node dist/scripts/create-platform-admin.js you@example.com \"Your Name\""
