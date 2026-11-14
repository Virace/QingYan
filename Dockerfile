FROM postgres:18.7@sha256:9f4fd4aa918f52ae3d6f3b687f1de90d8f867cd4d520021545a9a50c120eae3b AS pgtools

FROM node:24-trixie-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS deps
ARG QINGYAN_APT_MAIN_MIRROR=http://deb.debian.org/debian
ARG QINGYAN_COREPACK_NPM_REGISTRY=https://registry.npmjs.org
ARG QINGYAN_PNPM_REGISTRY=https://registry.npmjs.org

RUN sed -i "s|^URIs: http://deb.debian.org/debian$|URIs: ${QINGYAN_APT_MAIN_MIRROR}|" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN COREPACK_NPM_REGISTRY="$QINGYAN_COREPACK_NPM_REGISTRY" \
	COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
	npm_config_registry="$QINGYAN_PNPM_REGISTRY" \
	pnpm install --frozen-lockfile --registry="$QINGYAN_PNPM_REGISTRY"

FROM deps AS build

COPY . .
RUN pnpm build

FROM deps AS prod-deps

RUN pnpm prune --prod

FROM base AS runtime
ARG QINGYAN_APT_MAIN_MIRROR=http://deb.debian.org/debian
# PostgreSQL 18 客户端与 trixie 运行库保持同一 ABI，安全更新仍使用 Debian 官方源。
RUN sed -i "s|^URIs: http://deb.debian.org/debian$|URIs: ${QINGYAN_APT_MAIN_MIRROR}|" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends libpq5 liblz4-1 libzstd1 libreadline8t64 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=pgtools /usr/lib/postgresql/18/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=pgtools /usr/lib/postgresql/18/bin/pg_restore /usr/local/bin/pg_restore
COPY --from=pgtools /usr/lib/postgresql/18/bin/psql /usr/local/bin/psql
COPY --from=pgtools /usr/lib/x86_64-linux-gnu/libpq.so.5* /usr/lib/x86_64-linux-gnu/

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

COPY package.json pnpm-lock.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules

COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/docs/openapi.yaml ./docs/openapi.yaml
COPY --from=build /app/config/qingyan.example.yml ./config/qingyan.example.yml

RUN printf '#!/bin/sh\nexec node /app/dist/cli/main.js "$@"\n' > /usr/local/bin/qyctl \
	&& chmod +x /usr/local/bin/qyctl \
	&& cp /usr/local/bin/qyctl /usr/local/bin/qingyanctl

RUN mkdir -p /app/data /app/config /app/docs /app/logs

EXPOSE 4401

CMD ["node", "dist/server.js"]
