# Glama GSC Maestro hosted demo: NO authorized accounts, OAuth or local SQLite.
FROM node:22-bookworm-slim AS deps
WORKDIR /opt/gsc
COPY glama/gsc/package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="GSC Maestro hosted public metrics utilities" \
      org.opencontainers.image.description="Only user-provided aggregate metric calculations, no live data or credentials"
WORKDIR /opt/gsc
COPY --from=deps /opt/gsc/node_modules ./node_modules
COPY glama/gsc/ ./glama/gsc/
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node","glama/gsc/server.mjs"]
