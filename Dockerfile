FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY . .
RUN pnpm build

FROM base AS runtime

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/docs/openapi.yaml ./docs/openapi.yaml
COPY --from=build /app/config/qingyan.example.yml ./config/qingyan.example.yml

RUN mkdir -p /app/data /app/config /app/docs /app/logs

EXPOSE 4401

CMD ["node", "dist/server.js"]
