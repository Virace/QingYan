FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS deps
ARG QINGYAN_APT_MAIN_MIRROR=http://deb.debian.org/debian
ARG QINGYAN_COREPACK_NPM_REGISTRY=https://registry.npmjs.org
ARG QINGYAN_PNPM_REGISTRY=https://registry.npmjs.org
ARG QINGYAN_NODE_DIST_URL=https://nodejs.org/download/release
ARG QINGYAN_BETTER_SQLITE3_BINARY_HOST=https://github.com/WiseLibs/better-sqlite3/releases/download

# 仅切换 Debian 主仓库；安全更新继续使用 Debian 官方源。
RUN sed -i \
		"s|^URIs: http://deb.debian.org/debian$|URIs: ${QINGYAN_APT_MAIN_MIRROR}|" \
		/etc/apt/sources.list.d/debian.sources \
	&& apt-get \
		-o Acquire::Retries=3 \
		-o Acquire::http::Timeout=30 \
		-o Acquire::ForceIPv4=true \
		-o Acquire::https::Timeout=30 \
		update \
	&& apt-get \
		-o Acquire::Retries=3 \
		-o Acquire::http::Timeout=30 \
		-o Acquire::ForceIPv4=true \
		-o Acquire::https::Timeout=30 \
		install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN COREPACK_NPM_REGISTRY="$QINGYAN_COREPACK_NPM_REGISTRY" \
	COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
	npm_config_registry="$QINGYAN_PNPM_REGISTRY" \
	npm_package_config_node_gyp_dist_url="$QINGYAN_NODE_DIST_URL" \
	npm_config_disturl="$QINGYAN_NODE_DIST_URL" \
	npm_config_better_sqlite3_binary_host_mirror="$QINGYAN_BETTER_SQLITE3_BINARY_HOST" \
	pnpm install --frozen-lockfile --registry="$QINGYAN_PNPM_REGISTRY"

FROM deps AS build

COPY . .
RUN pnpm build

FROM deps AS prod-deps

RUN pnpm prune --prod

FROM base AS runtime

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
