# Standalone explorer service: builds the wasm SDK + the static SPA and serves
# it. Unlike docker/Dockerfile.railway (the devnet-in-a-box) this skips the
# coordinator/node/cli Rust binaries, so it builds in a few minutes and is meant
# for iterating on the UI without rebuilding the whole devnet.
#
# Build context must be the REPO ROOT (the explorer depends on the bte-sdk
# workspace package). On Railway, leave Root Directory empty and point the
# service at this Dockerfile (railway.explorer.json, or RAILWAY_DOCKERFILE_PATH).
#
# The coordinator and relayer URLs are inlined at build time (Vite), so pass:
#   VITE_BTE_URL      coordinator base URL for /v0 sealing. Cross-origin here
#                     (the standalone explorer is not behind the devnet Caddy),
#                     which is fine: the coordinator sends permissive CORS.
#   VITE_RELAYER_URL  relayer base URL (sponsored swaps).

# -- stage 1: wasm for the sdk (the only Rust here) --------------------------
FROM rust:1.95-slim AS wasm
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown \
    && { curl -sSf --retry 3 --retry-all-errors --connect-timeout 15 \
           https://rustwasm.github.io/wasm-pack/installer/init.sh | sh \
         && command -v wasm-pack; } \
       || cargo install wasm-pack --locked
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY .cargo ./.cargo
COPY crates ./crates
RUN wasm-pack build crates/bte-wasm --target web --release --out-dir pkg-seal \
    && wasm-pack build crates/bte-wasm --target web --release --out-dir pkg-verify -- --features verify

# -- stage 2: build the SPA --------------------------------------------------
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY demos ./demos
COPY examples ./examples
COPY --from=wasm /app/crates/bte-wasm/pkg-seal ./crates/bte-wasm/pkg-seal
COPY --from=wasm /app/crates/bte-wasm/pkg-verify ./crates/bte-wasm/pkg-verify
RUN pnpm install --frozen-lockfile=false
ARG VITE_BTE_URL
ARG VITE_RELAYER_URL
ENV VITE_BTE_URL=$VITE_BTE_URL
ENV VITE_RELAYER_URL=$VITE_RELAYER_URL
# BTE_SKIP_WASM_PACK reuses the wasm built in stage 1 instead of invoking
# wasm-pack again (which is absent on node:22-slim).
RUN BTE_SKIP_WASM_PACK=1 pnpm --filter bte-sdk build && pnpm --filter bte-explorer build

# -- stage 3: serve ----------------------------------------------------------
FROM node:22-slim AS serve
RUN npm i -g serve@14
COPY --from=build /repo/packages/explorer/dist /app/dist
ENV PORT=3000
EXPOSE 3000
# -s: SPA fallback so hash routes resolve to index.html.
CMD serve -s /app/dist -l ${PORT}
