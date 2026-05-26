FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS deps

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
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
