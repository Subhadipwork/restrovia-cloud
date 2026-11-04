# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @restrovia/api --workspace @restrovia/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @restrovia/shared && npm run build -w @restrovia/api \
  && npm prune --omit=dev --workspace @restrovia/api --workspace @restrovia/shared

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
WORKDIR /app/apps/api
USER node
EXPOSE 4000
# Migrations only add; they run before every start so a deploy never serves an old schema.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
