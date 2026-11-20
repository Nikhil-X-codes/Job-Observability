FROM node:26.13.1-bookworm-slim AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/telemetry/package.json packages/telemetry/package.json
COPY services/dispatcher/package.json services/dispatcher/package.json
COPY services/worker/package.json services/worker/package.json
COPY services/scheduler/package.json services/scheduler/package.json

FROM manifests AS db-build
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN npm ci --workspace @jobflow/db --include-workspace-root
COPY prisma.config.mjs ./
COPY packages/db/prisma packages/db/prisma
RUN npm run db:generate

FROM manifests AS runtime
ENV NODE_ENV=production
RUN npm ci --omit=dev --workspace @jobflow/api --workspace @jobflow/db --workspace @jobflow/queue \
  --workspace @jobflow/dispatcher --workspace @jobflow/worker --workspace @jobflow/scheduler \
  --workspace @jobflow/telemetry
COPY packages/db/src packages/db/src
COPY packages/telemetry/src packages/telemetry/src
COPY --from=db-build /app/packages/db/generated packages/db/generated
USER node

FROM runtime AS api
COPY apps/api/src apps/api/src
EXPOSE 3000
CMD ["node", "apps/api/src/server.js"]

FROM runtime AS processing
COPY packages/queue/src packages/queue/src
COPY services/dispatcher/src services/dispatcher/src
COPY services/worker/src services/worker/src
COPY services/scheduler/src services/scheduler/src

FROM db-build AS migrate
USER node
CMD ["npm", "run", "db:migrate"]

FROM manifests AS web-build
RUN npm ci --workspace @jobflow/web
COPY apps/web apps/web
RUN npm run build --workspace @jobflow/web

FROM caddy:2.11.9-alpine AS web
COPY infra/caddy/Caddyfile.local /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
EXPOSE 8080
