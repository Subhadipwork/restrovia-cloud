# Build from the repository root: docker build -f apps/owner/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/owner/package.json apps/owner/
RUN npm ci --workspace @restrovia/owner --workspace @restrovia/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/owner apps/owner
# next.config.ts reads these at build time; in production Caddy also sends /api/owner to the API.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL BUILD_STANDALONE=true NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @restrovia/shared && npm run build -w @restrovia/owner

FROM node:22-slim
ENV NODE_ENV=production PORT=3200 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/owner/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/owner/.next/static apps/owner/.next/static
COPY --from=build --chown=node:node /app/apps/owner/public apps/owner/public
USER node
EXPOSE 3200
CMD ["node", "apps/owner/server.js"]
