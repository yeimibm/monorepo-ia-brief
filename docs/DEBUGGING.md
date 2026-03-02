# 🐛 Guía de Debugging Profesional

Técnicas y herramientas para debuggear el sistema event-driven de órdenes e inventario.

---

## 📋 Tabla de Contenidos

- [Node Inspector (--inspect)](#node-inspector---inspect)
- [Logs Estructurados](#logs-estructurados)
- [Debuggear Eventos Kafka](#debuggear-eventos-kafka)
- [Detectar Problemas de Idempotencia](#detectar-problemas-de-idempotencia)
- [Consumer Lag & Offset](#consumer-lag--offset)
- [Troubleshooting Común](#troubleshooting-común)

---

## Node Inspector (--inspect)

### ¿Qué es?

Node.js tiene un debugger nativo que se conecta a Chrome DevTools. Permite:
- ✅ Poner breakpoints
- ✅ Paso a paso (step over/in/out)
- ✅ Inspeccionar variables
- ✅ Ver stack traces en tiempo real

### Iniciar Order Service con Inspector

```bash
# Terminal 1: Iniciar con inspector
cd packages/order-service
node --inspect=9229 dist/index.js

# Output esperado:
# Debugger listening on ws://127.0.0.1:9229/xyz-token
# [order-service] Listening on port 3001
```

### Conectar Chrome DevTools

**Opción 1: URL directa (Chrome/Edge)**
```
chrome://inspect
# O escribir en la barra:
# devtools://devtools/bundled/js_app.html?ws=127.0.0.1:9229/xyz-token
```

**Opción 2: VS Code**
```bash
# .vscode/launch.json:
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "attach",
      "name": "Attach Order Service",
      "port": 9229,
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

Luego: F5 → selecciona "Attach Order Service"

### Poner Breakpoint

**En código (permanente):**
```typescript
// src/handlers/checkout.ts
export const handleCheckout = async (c: Context) => {
  const body = await c.req.json();
  debugger;  // ← Se pausa aquí cuando el inspector está activo
  
  const order = await createOrder(body);
  return c.json(order);
};
```

**Desde DevTools (temporal):**
1. Abre DevTools en chrome://inspect
2. Navega a Sources → orden-service
3. Click en número de línea para poner breakpoint
4. Haz una request: `curl http://localhost:3001/checkout ...`
5. La ejecución se pausa en el breakpoint

### Inspeccionar Variables

Cuando estés en un breakpoint:
- **Variables locales**: Panel derecho bajo "Scope"
- **Console**: Escribe expresiones: `order.id`, `body.productId`
- **Hover**: Pasa mouse sobre una variable

**Ejemplo interactivo:**
```javascript
// Estás pausado en: const orderId = generateUUID();
// En console escribes:
> orderId
"550e8400-e29b-41d4-a716-446655440000"

> order
{ id: "550e8400...", status: "PENDING", created_at: "2024-01-15T..." }

> JSON.stringify(order, null, 2)
// Output indentado
```

### Debuggear Async/Events

**Pausa en Promises:**
```bash
# Terminal:
node --inspect=9229 dist/index.js

# DevTools → Sources → Breakpoints → "Pause on Caught Exceptions"
# Checkear ambas opciones para ver excepciones de Promises
```

**Debuggear Consumer de Kafka:**
```typescript
// src/kafka/consumer.ts
consumer.on('message', async (msg) => {
  debugger;  // ← Se pausa aquí
  const event = JSON.parse(msg.value);
  await handleEvent(event);
});
```

---

## Logs Estructurados

### Formato JSON (Pino)

Tu aplicación usa **Pino** para logging. Los logs son JSON, no texto plano:

```json
{
  "level": 30,
  "time": "2024-01-15T10:30:45.123Z",
  "pid": 12345,
  "hostname": "order-service",
  "msg": "Order created successfully",
  "order_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING",
  "correlation_id": "trace-abc-123",
  "duration_ms": 42,
  "service": "order-service"
}
```

### Niveles de Log

```
60 = FATAL   (aplicación muere)
50 = ERROR   (algo falló)
40 = WARN    (algo sospechoso)
30 = INFO    (evento importante)
20 = DEBUG   (detalles técnicos)
10 = TRACE   (muy detallado)
```

### Leer Logs Bonito (Pretty-print)

**Opción 1: Usar pino-pretty**
```bash
# Instalar:
npm install --save-dev pino-pretty

# Ejecutar con pretty-print:
node dist/index.js | npx pino-pretty

# Output:
[10:30:45.123] INFO (order-service 12345): Order created successfully
              order_id: "550e8400..."
              status: "PENDING"
              correlation_id: "trace-abc-123"
```

**Opción 2: jq (ifiestá instalado)**
```bash
docker compose logs order-service | jq '.msg, .order_id, .correlation_id'

# Output (solo esos campos):
"Order created successfully"
"550e8400-e29b-41d4-a716-446655440000"
"trace-abc-123"
```

**Opción 3: Buscar por correlation_id**
```bash
# Ver TODO lo que pasó con un request específico:
docker compose logs | jq 'select(.correlation_id == "trace-abc-123")'

# Output: todos los eventos con ese correlation_id
```

### Tracer un Request Completo

**Paso 1: Notar correlation_id de una orden**
```bash
curl -X POST http://localhost:3001/checkout \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: my-trace-123" \
  -d '{"product_id":"LAPTOP-001","quantity":2,"customer_name":"Alice"}' | jq

# Response: {"order_id":"abc-123","status":"PENDING",...}
```

**Paso 2: Buscar todos los logs con ese ID**
```bash
docker compose logs | jq 'select(.correlation_id == "my-trace-123")'
```

**Paso 3: Leer secuencia de eventos**
```
[10:30:45.100] Order Service:    Orden creada           order_id=abc-123, status=PENDING
[10:30:45.150] Order Service:    Evento publicado       event_type=order.created
[10:30:46.200] Inventory Service: Evento consumido      event_type=order.created
[10:30:46.250] Inventory Service: Stock verificado      available=5, required=2 → OK
[10:30:46.300] Inventory Service: Stock reservado       reservation_id=res-456
[10:30:46.350] Inventory Service: Evento publicado      event_type=inventory.reserved
[10:30:46.400] Order Service:    Evento consumido      event_type=inventory.reserved
[10:30:46.420] Order Service:    Estado actualizado     status=CONFIRMED
```

### Loggear Dentro de Código

**Buen logging (NO loggear datos sensibles):**
```typescript
// ✅ BIEN
logger.info({ 
  order_id: orderId,
  product_id: productId,
  quantity,
  status: 'CONFIRMED'
}, 'Order confirmed');

// ❌ MAL - Expone contraseña
logger.info({
  order_details: body,  // ← Body contiene customer_email
  db_password: process.env.DB_PASSWORD  // ← NUNCA
}, 'Order created');
```

**Error logging con stack trace:**
```typescript
try {
  await reserveInventory(orderId);
} catch (error) {
  logger.error({
    error: error.message,
    stack: error.stack,
    order_id: orderId,
    attempted_quantity: quantity
  }, 'Failed to reserve inventory');
}
```

---

## Debuggear Eventos Kafka

### Ver Mensajes en Tiempo Real

**Consumir últimos 10 eventos de un topic:**
```bash
docker compose exec redpanda rpk topic consume order.created --num 10 --from-beginning
```

**Output esperado:**
```json
{
  "event_type": "order.created",
  "event_id": "evt-123",
  "order_id": "order-abc",
  "product_id": "LAPTOP-001",
  "quantity": 2,
  "correlation_id": "trace-xyz",
  "timestamp": "2024-01-15T10:30:45.123Z"
}
```

### Debuggear Consumer Lag

**¿Qué es?** El retraso entre el offset actual del topic y lo que ya se consumió.

```bash
# Ver lag de inventory-service
docker compose exec redpanda rpk group describe inventory-service

# Output:
# GROUP                       TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG   MEMBER-ID
# inventory-service           order.created   0          25              25              0     consumer-XXX
#                                                        ↑               ↑               ↑
#                                                    Ya procesado  Total mensajes  Sin retraso
```

**Si LAG > 0:**
```bash
# inventory-service está retrasado
# Significa:
# - Hay 5 eventos sin procesar
# - inventory-service probablemente está lento o caído

docker compose logs inventory-service | tail -50
# Busca errores o advertencias
```

### Debuggear Evento Específico

**Escenario**: Sabes que ORDER-ABC falló, quieres ver el evento original.

```bash
# 1. Busca en logs:
docker compose logs inventory-service | grep ORDER-ABC

# Output:
# 2024-01-15T10:30:46.200Z ERROR: Failed to process event event_id=evt-456

# 2. Busca ese evento en Kafka:
docker compose exec redpanda rpk topic consume order.created --from-beginning | grep -A 5 '"order_id":"ORDER-ABC"'

# Output: El evento JSON que se publicó originalmente
```

### Replayear Eventos

**Si necesitas reprocesar ordenes antiguas:**

```bash
# Resetear consumer group a offset 0 (recomienza desde el inicio)
docker compose exec redpanda rpk group seek inventory-service --group inventory-service --to-earliest order.created

# Luego reinicia inventory-service:
docker compose restart inventory-service

# El servicio reprocessará TODOS los eventos desde el inicio
```

⚠️ **CUIDADO**: Si los eventos se procesaron dos veces, tabla `processed_events` evita duplicación.

---

## Detectar Problemas de Idempotencia

### ¿Qué es el problema?

Si un evento se procesa 2 veces por error de red o crash:
- ❌ SIN idempotencia: El inventario se descuenta 2 veces
- ✅ CON idempotencia: Se descuenta 1 vez (la tabla `processed_events` lo evita)

### Verificar Idempotencia en BD

**Simulemos fallo:**
```bash
# Terminal 1: Inventory-service con crash mode
docker-compose stop inventory-service
```

**Terminal 2: Crear orden**
```bash
curl -X POST http://localhost:3001/checkout \
  -H "Content-Type: application/json" \
  -d '{"product_id":"TEST-001","quantity":1,"customer_name":"Test"}' | jq '.order_id'

# Output: order-xyz
# Nota: Quedará en estado PENDING
```

**Terminal 1: Reinicia inventory-service**
```bash
docker-compose start inventory-service
```

**Terminal 2: Verifica que NO se procesó 2 veces**
```bash
docker compose exec inventory-service psql -U inventory_user -d inventory_db -c \
  "SELECT event_id, order_id, created_at FROM processed_events WHERE order_id = 'order-xyz';"

# Output esperado:
# event_id     | order_id | created_at
# evt-abc-123  | order-xyz| 2024-01-15 10:30:46.123
#
# ✅ Solo 1 fila = Evento procesado 1 vez (idempotente)
# ❌ 2 filas = Evento procesado 2 veces (problema)
```

### Validar Integridad de Datos

**Script para auditar:**
```sql
-- En inventory-db

-- 1. ¿Cuántos eventos se procesaron vs cuántas reservas?
SELECT 
  COUNT(DISTINCT event_id) as eventos_unicos,
  COUNT(DISTINCT order_id) as ordenes_procesadas
FROM processed_events;

-- 2. ¿Hay duplicados de event_id?
SELECT event_id, COUNT(*) 
FROM processed_events 
GROUP BY event_id 
HAVING COUNT(*) > 1;
-- Output vacío = ✅ Sin duplicados


-- 3. ¿Stock negativo (problema)?
SELECT product_id, available 
FROM inventory 
WHERE available < 0;
-- Output vacío = ✅ Stock correcto
```

---

## Consumer Lag & Offset

### Conceptos

```
Offset = número de posición en el topic (0, 1, 2, ...)
         Como el "renglón" en un archivo

Consumer Group = nombre del consumidor
                 (inventory-service, order-service, audit-service)

Lag = (Último offset del topic) - (Offset consumido)
      = Cuántos mensajes esperan procesarse
```

### Ver Estado

**Ver todos los consumer groups:**
```bash
docker compose exec redpanda rpk group list

# Output:
# GROUP             MEMBERS  TOPICS
# inventory-service 1        order.created
# order-service     1        inventory.reserved, inventory.rejected
```

**Ver offsets detallados:**
```bash
docker compose exec redpanda rpk group describe order-service

# Output:
# TOPIC             PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# inventory.reserved  0        50              50              0    ← Al día
# inventory.rejected  0        10              15              5    ← Retrasado 5 msgs
```

### Resetear Consumer Position

**Escenario**: Quisiste reprocessar eventos desde cierto punto.

```bash
# Resetear a offset 0 (reinicia desde inicio)
docker compose exec redpanda rpk group seek order-service \
  --group order-service \
  --to-earliest inventory.reserved

# Resetear a offset específico (ej: 100)
docker compose exec redpanda rpk group seek order-service \
  --group order-service \
  --to-offset 100 inventory.reserved

# Resetear a timestamp específico (ej: hace 1 hora)
docker compose exec redpanda rpk group seek order-service \
  --group order-service \
  --to-timestamp -3600000 inventory.reserved  # milliseconds ago
```

---

## Troubleshooting Común

### 🔴 "Order quedó en estado PENDING para siempre"

**Diagnóstico:**

```bash
# 1. Verificar que inventory-service está vivo
docker compose ps inventory-service
# Esperado: STATUS: Up (healthy)

# 2. Verificar consumer lag
docker compose exec redpanda rpk group describe inventory-service
# Si LAG > 0: hay eventos sin procesar

# 3. Ver logs de error
docker compose logs inventory-service | grep -i error | tail -20

# 4. Verificar conexión a BD
docker compose exec inventory-service psql -U inventory_user -d inventory_db -c "SELECT 1;"
# Debería retornar: 1 (OK)

# 5. Verificar Kafka connectivity
docker compose exec inventory-service sh -c "echo 'test' | nc -zv redpanda 9092"
# Esperado: succeeded (OK)
```

**Soluciones:**
- Si inventory-service está muerto: `docker compose restart inventory-service`
- Si BD no responde: `docker compose restart inventory-db`
- Si Kafka no responde: `docker compose restart redpanda`

### 🔴 "Evento se procesó 2 veces"

**Diagnóstico:**
```bash
# Busca el order_id problemático
docker compose exec inventory-db psql -U inventory_user -d inventory_db -c \
  "SELECT event_id, COUNT(*) 
   FROM processed_events 
   GROUP BY event_id 
   HAVING COUNT(*) > 1;"

# Si retorna filas: hay duplicados

# Ver qué pasó en la orden
docker compose exec orders-db psql -U orders_user -d orders_db -c \
  "SELECT * FROM orders WHERE id = 'order-problemático';"

# Ver reservas
docker compose exec inventory-db psql -U inventory_user -d inventory_db -c \
  "SELECT * FROM reserved_items WHERE order_id = 'order-problemático';"
```

**Solución**: 
- Tu tabla `processed_events` debe tener PRIMARY KEY en `event_id`
- Si hay duplicados, significa que la constraint no funciona
- Verificar: `\d processed_events` en psql

### 🟡 "Kafka topic no existe"

**Error esperado:**
```json
{
  "error": "Topic order.created does not exist",
  "correlation_id": "test-123"
}
```

**Solución:**
```bash
# Crear topic manualmente
docker compose exec redpanda rpk topic create order.created --partitions 1 --replicas 1

# Verificar
docker compose exec redpanda rpk topic list
```

### 🟠 "Connection refused" a Kafka

**Error:**
```
ECONNREFUSED 127.0.0.1:9092
```

**Soluciones:**
```bash
# 1. Verificar que redpanda está corriendo
docker compose ps redpanda

# 2. Verificar puerto
docker compose port redpanda 9092

# 3. Desde contenedor, la dirección es "redpanda:9092"
#    Desde host, es "localhost:9092"
#    Verificar tu .env local
```

---

## Quick Reference: Debugging Checklist

```
[ ] ¿Servicio corriendo?
    docker compose ps
    
[ ] ¿Logs sin errores?
    docker compose logs service-name | grep -i error
    
[ ] ¿Kafka conectado?
    docker compose exec redpanda rpk cluster info
    
[ ] ¿BD conectada?
    docker compose exec orders-db psql -U orders_user -d orders_db -c "SELECT 1;"
    
[ ] ¿Consumer lag?
    docker compose exec redpanda rpk group describe inventory-service
    
[ ] ¿Eventos en topic?
    docker compose exec redpanda rpk topic consume order.created --num 1
    
[ ] ¿Orden en BD?
    docker compose exec orders-db psql -U orders_user -d orders_db -c "SELECT * FROM orders ORDER BY created_at DESC LIMIT 1;"
    
[ ] ¿Evento duplicado?
    SELECT event_id, COUNT(*) FROM processed_events GROUP BY event_id HAVING COUNT(*) > 1;
```

---

**Next**: Lee [CHAOS-SCENARIOS.md](./CHAOS-SCENARIOS.md) para testing avanzado.
