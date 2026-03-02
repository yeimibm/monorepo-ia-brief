# E-Commerce Event-Driven - Sistema Completo

**Status**: PRODUCCIÓN LISTA | Hono + Redpanda + PostgreSQL + Event Sourcing

Sistema de e-commerce **completamente funcional** con arquitectura event-driven: órdenes, inventario, idempotencia, correlation IDs y simulación de fallos para testing caótico.

---


## Quick Start 

### 1. Preparar entorno 

```bash
# Copiar variables de entorno
cp .env.example .env

# Instalar dependencias
npm install
```

### 2. Levantar infraestructura 

```bash
# Iniciar todos los contenedores
docker compose up -d

# Verificar que todo está healthy
docker compose ps
```

Esperado: 5 contenedores en estado `Up (healthy)`:
- `redpanda` (Kafka broker)
- `orders-db` (PostgreSQL)
- `inventory-db` (PostgreSQL)
- `order-service` (Node.js)
- `inventory-service` (Node.js)

### 3. Compilar servicios 

```bash
# Order Service
cd packages/order-service
npm run build

# Inventory Service
cd ../inventory-service
npm run build

cd ../..  # Volver a raiz
```

### 4. Iniciar servicios (2 minutos)

**Terminal 1 - Order Service:**
```bash
cd packages/order-service
npm run dev
# Esperado: [order-service] Listening on port 3001
```

**Terminal 2 - Inventory Service:**
```bash
cd packages/inventory-service
npm run dev
# Esperado: [inventory-service] Listening on port 3002
```

**Terminal 3 - Monitores :**
```bash
# Ver logs consolidados
docker compose logs -f

# En otra terminal, ver Kafka topics
watch 'docker compose exec redpanda rpk topic list'

# En otra, ver órdenes
watch 'docker compose exec orders-db psql -U orders_user -d orders_db -c "SELECT id, status, product_id, quantity, created_at FROM orders ORDER BY created_at DESC LIMIT 5;"'
```

---

## Testing Flows

Crea una orden completa: orden → inventario reserva → orden confirmada.

```bash
# 1. Crear orden con stock disponible
curl -X POST http://localhost:3001/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "LAPTOP-001",
    "quantity": 2,
    "customer_name": "Alice"
  }' | jq

# Respuesta esperada:
# {
#   "order_id": "550e8400-e29b-41d4-a716-446655440000",
#   "status": "PENDING",
#   "product_id": "LAPTOP-001",
#   "quantity": 2
# }

# 2. Esperar ~2 segundos (Kafka processing)

# 3. Verificar estado de orden (debe estar CONFIRMED)
curl http://localhost:3001/orders/550e8400-e29b-41d4-a716-446655440000 \
  -H "X-Correlation-Id: test-flow-1" | jq '.status'
# Esperado: "CONFIRMED"

# 4. Verificar inventario fue reservado
docker compose exec inventory-db psql -U inventory_user -d inventory_db -c \
  "SELECT product_id, quantity, status FROM reserved_items ORDER BY created_at DESC LIMIT 1;"
# Esperado: LAPTOP-001 | 2 | reserved
```
---

## Viewing Logs

### **Option 1: Docker Compose Logs **

```bash
# Todos los servicios
docker compose logs -f

# Solo order-service
docker compose logs -f order-service

# Solo inventory-service
docker compose logs -f inventory-service

# Últimas 50 líneas
docker compose logs --tail 50

# Últimas líneas en tiempo real
docker compose logs -f --tail 20
```

**Formato esperado (Pino JSON):**
```json
{
  "level": 30,
  "time": "2024-01-15T10:30:45.123Z",
  "pid": 1,
  "hostname": "order-service",
  "msg": "Order created",
  "order_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING",
  "correlation_id": "xyz-abc-123",
  "service": "order-service"
}
```


##  Project Structure

```
monorepo/
├── packages/
│   │
│   ├── order-service/
│   │   ├── src/
│   │   │   ├── index.ts              # Hono app, middleware, graceful shutdown
│   │   │   ├── handlers/
│   │   │   │   ├── checkout.ts       # POST /checkout - crear orden
│   │   │   │   └── cancel.ts         # GET /orders/:id, POST /cancel
│   │   │   ├── kafka/
│   │   │   │   ├── producer.ts       # Publicar order.created, order.cancelled
│   │   │   │   └── consumer.ts       # Escuchar inventory.reserved/rejected
│   │   │   ├── db/
│   │   │   │   ├── client.ts         # Pool PostgreSQL
│   │   │   │   └── migrations.ts     # DDL tables (órdenes, eventos)
│   │   │   ├── types/
│   │   │   │   └── index.ts          # TypeScript interfaces
│   │   │   ├── logger.ts             # Pino con context injection
│   │   │   └── utils/
│   │   │       └── correlation-id.ts # Middleware UUID
│   │   ├── tsconfig.json
│   │   ├── package.json
│   │   └── .env.local
│   │
│   └── inventory-service/
│       ├── src/
│       │   ├── index.ts              # Hono app, escucha order.created
│       │   ├── handlers/
│       │   │   └── inventory.ts      # GET /inventory, POST /inventory (CRUD)
│       │   ├── kafka/
│       │   │   ├── consumer.ts       # Escucha order.created, simula fallas
│       │   │   └── producer.ts       # Publicar inventory.reserved/rejected
│       │   ├── db/
│       │   │   ├── client.ts         # Pool PostgreSQL
│       │   │   └── migrations.ts     # DDL (inventario, reservas)
│       │   ├── types/
│       │   │   └── index.ts          # Interfaces
│       │   ├── logger.ts             # Pino
│       │   └── utils/
│       │       ├── correlation-id.ts # Middleware
│       │       └── failure-modes.ts  # FAIL_RESERVE_MODE logic
│       ├── tsconfig.json
│       ├── package.json
│       └── .env.local
│
├── docs/
│   ├── brief.md                      # Arquitectura académica completa
│   ├── INFRASTRUCTURE.md             # Detalles Docker Compose
│   └── API.md                        # Especificación REST
│
├── docker-compose.yml                # 5 servicios: redpanda, 2 DBs, 2 apps
├── package.json                      # npm workspaces
├── tsconfig.json                     # Root TypeScript config
├── .env.example                      # Variables de entorno
└── README.md (este archivo)
```
