# Dockerfile para Inventory Service

FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/inventory-service ./packages/inventory-service/
COPY tsconfig.json ./

RUN npm ci --workspaces

WORKDIR /app/packages/inventory-service
RUN npm run build

# =========================================================================
# RUNTIME
# =========================================================================
FROM node:20-alpine

WORKDIR /app

# Instalar wget para healthcheck
RUN apk add --no-cache wget

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/inventory-service/dist /app/dist
COPY --from=builder /app/packages/inventory-service/package.json /app/package.json

EXPOSE 3002

CMD ["node", "dist/index.js"]
