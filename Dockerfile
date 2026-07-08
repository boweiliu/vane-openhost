FROM node:24.5.0-slim AS builder

ARG VANE_REPO=https://github.com/ItzCrazyKns/Vane.git
ARG VANE_REF=master

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git python3 python3-pip sqlite3 patch build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch "$VANE_REF" "$VANE_REPO" vane
WORKDIR /src/vane

COPY patches /tmp/patches
RUN for p in /tmp/patches/*.patch; do [ -e "$p" ] && patch -p1 < "$p"; done

RUN yarn install --frozen-lockfile --network-timeout 600000
RUN mkdir -p /src/vane/data
RUN yarn build

FROM node:24.5.0-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates caddy curl tini \
    && rm -rf /var/lib/apt/lists/*

ENV APP_DIR=/opt/vane
ENV APP_PORT=8080
ENV VANE_PORT=3000
ENV SEARXNG_API_URL=https://searxng.oh.bowei.in/

WORKDIR /opt/vane
COPY --from=builder /src/vane/public ./public
COPY --from=builder /src/vane/.next/static ./public/_next/static
COPY --from=builder /src/vane/.next/standalone ./
COPY --from=builder /src/vane/drizzle ./drizzle
COPY openhost /app/openhost
COPY Caddyfile /app/Caddyfile
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
