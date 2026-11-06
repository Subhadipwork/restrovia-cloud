# Build from the repository root: docker build -f apps/admin/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN npm ci --workspace @restrovia/admin --workspace @restrovia/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/admin apps/admin
# next.config.ts reads these at build time; in production Caddy also sends /api/admin to the API.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL BUILD_STANDALONE=true NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @restrovia/shared && npm run build -w @restrovia/admin

FROM node:22-slim
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/admin/.next/static apps/admin/.next/static
COPY --from=build --chown=node:node /app/apps/admin/public apps/admin/public
USER node
EXPOSE 3100
CMD ["node", "apps/admin/server.js"]
