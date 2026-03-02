# Dockerfile para Order Service
# Construcción multi-stage para imagen optimizada

# =========================================================================
# ETAPA 1: BUILD
# =========================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar archivos raíz
COPY package*.json ./
COPY packages/order-service ./packages/order-service/
COPY tsconfig.json ./

# Instalar dependencias (incluyendo workspaces)
RUN npm ci --workspaces

# Compilar TypeScript
WORKDIR /app/packages/order-service
RUN npm run build

# =========================================================================
# ETAPA 2: RUNTIME
# =========================================================================
FROM node:20-alpine

WORKDIR /app

# Instalar wget para healthcheck
RUN apk add --no-cache wget

# Copiar node_modules del builder
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/order-service/dist /app/dist
COPY --from=builder /app/packages/order-service/package.json /app/package.json

# Exponer puerto
EXPOSE 3001

# Comando de inicio
CMD ["node", "dist/index.js"]
