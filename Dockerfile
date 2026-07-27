FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS deps

# 暂时固定主仓库到 TUNA；安全更新继续使用 Debian 官方源。
RUN sed -i \
		's|^URIs: http://deb.debian.org/debian$|URIs: http://mirrors.tuna.tsinghua.edu.cn/debian|' \
		/etc/apt/sources.list.d/debian.sources \
	&& apt-get \
		-o Acquire::Retries=3 \
		-o Acquire::http::Timeout=30 \
		-o Acquire::ForceIPv4=true \
		update \
	&& apt-get \
		-o Acquire::Retries=3 \
		-o Acquire::http::Timeout=30 \
		-o Acquire::ForceIPv4=true \
		install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

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
