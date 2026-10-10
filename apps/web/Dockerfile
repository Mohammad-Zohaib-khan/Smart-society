# Build from the repository root:  docker build -f apps/web/Dockerfile -t smart-society-web .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace apps/web

FROM nginx:1.27-alpine
# Rendered to /etc/nginx/conf.d/default.conf by the image's entrypoint (envsubst) at start-up.
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Where /api is proxied. Override per environment (Azure Container Apps: http://<api-app-name>).
ENV API_UPSTREAM=http://api:4000
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
