# 🎯 Índice de Calidad y Debugging

Guía completa para testing, debugging, observabilidad, chaos engineering y escalado del sistema de órdenes.

---

## 📚 Documentación Completa

### 1. **[TESTING.md](./TESTING.md)** - Pruebas Unitarias
**Archivo:** `packages/order-service/__tests__/checkout.test.js` (360 líneas)

```bash
npm test                 # Ejecutar todas las pruebas
npm run test:watch      # Modo observación (auto-rerun)
npm run test:verbose    # Con salida colorida
```

**Cubre:**
- ✅ Crear órdenes (POST /checkout)
- ✅ Persistencia en BD
- ✅ Publicación de eventos en Kafka
- ✅ Correlación de IDs entre capas
- ✅ Validación de datos
- ✅ Manejo de errores
- ✅ Detección de idempotencia
- ✅ Timestamps correctos
- ✅ Desconexiones de BD/Kafka
- ✅ Unicidad de order_id

**Mocks:**
- `MockKafkaProducer`: Simula publicador de eventos
- `MockOrderDatabase`: Simula BD en memoria

**Filosofía:** Tests rápidos (cero dependencias externas), enfocados en lógica de negocio.

---

### 2. **[DEBUGGING.md](./DEBUGGING.md)** - Guía de Debugging (450 líneas)

#### Herramientas

| Herramienta | Comando | Uso |
|---|---|---|
| **Node Inspector** | `node --inspect=9229 dist/index.js` | Breakpoints, variables, call stack |
| **Chrome DevTools** | `chrome://inspect` | GUI para inspeccionar procesos Node |
| **VS Code Debugger** | `F5` (con launch.json) | Debugging integrado en IDE |
| **Pino Logs** | `grep "level": 30` | Búsqueda en logs estructurados |
| **jq** | `jq '.message' logs.json` | Parsing JSON en terminal |
| **rpk** | `rpk topic consume order.created` | Ver eventos en Kafka |

#### Secciones Principales

**2.1 Node Inspector** (80 líneas)
- Iniciar con `--inspect=9229`
- Conectar Chrome DevTools
- Configurar launch.json para VS Code
- Poner breakpoints en código
- Inspeccionar variables y watch
- Debuggear async/promises

**2.2 Logging Estructurado** (120 líneas)
- Formato JSON de Pino
- Niveles (FATAL=60, ERROR=50, WARN=40, INFO=30, DEBUG=20, TRACE=10)
- Pretty-print con `pino-pretty` y `jq`
- Correlation ID: rastrear requests entre servicios
- Ejemplo: 5 eventos (order.created → inventory.reserved → order.confirmed)
- Qué loggear y qué NO loggear (seguridad)

**2.3 Debugging de Kafka** (80 líneas)
- Ver topics: `rpk topic list`
- Ver eventos: `rpk topic consume order.created --num 10 --from-beginning`
- Consumer lag: `rpk group describe inventory-service`
- Replay de eventos desde offset 0
- Verificar particiones

**2.4 Detección de Idempotencia** (100 líneas)
- Query: `SELECT * FROM processed_events WHERE order_id = 'X'`
- Simular crash: matar servicio, crear orden, reiniciar, verificar no hay doble-procesamiento
- Auditar BD para detectar duplicados
- Verificar que event_id de cada evento es único

**2.5 Troubleshooting** (70 líneas)
- "Orden atrapada en PENDING": checklist de diagnóstico
- "Evento procesado 2 veces": detectar duplicados
- "Topic Kafka falta": crear manualmente
- "Connection refused": verificar Docker, puertos

---

### 3. **[HTTP Logging Middleware](../packages/order-service/src/utils/http-logger.ts)** - Observabilidad (180 líneas)

```typescript
import { httpLogger, createErrorHandler } from './utils/http-logger';

app.use(httpLogger());  // Middleware global

// En handlers:
app.post('/checkout', createErrorHandler(async (c) => {
  const event = await c.req.json();
  // Tu lógica...
  return c.json({ status: 'pending' });
}));
```

**Características:**
- 📊 Métricas: `method`, `path`, `status`, `duration_ms`, `bytes_sent`
- 🔗 Correlation ID inyectado desde header `X-Correlation-Id` (o auto-generado)
- 🤐 Seguridad: NUNCA loggea passwords, tokens, auth headers
- 🔔 Errores con stack trace completo
- 🚫 Saltea logs de healthcheck (`/health`, `/ready`)

**Ejemplo de log:**
```json
{
  "level": 30,
  "time": "2024-01-15T10:23:45.123Z",
  "method": "POST",
  "path": "/checkout",
  "status": 200,
  "duration_ms": 145,
  "bytes_sent": 256,
  "correlation_id": "req-abc123xyz",
  "message": "HTTP response"
}
```

---

### 4. **[CHAOS-SCENARIOS.md](./CHAOS-SCENARIOS.md)** - Chaos Engineering (400 líneas)

#### 4 Modos de Fallo

##### **Modo 1: Reject (Rechazo Aleatorio)**
```bash
FAIL_RESERVE_MODE=reject
FAIL_RESERVE_PERCENT=50  # 50% de órdenes rechazadas
```
- **Resultado:** De 10 órdenes → 5 CONFIRMED, 5 REJECTED
- **Demuestra:** Manejo automático de fallos sin intervención manual
- **Video:** 2 minutos de narración + curl requests

##### **Modo 2: Crash (Caída de Servicio)**
```bash
FAIL_RESERVE_MODE=crash
FAIL_RESERVE_PERCENT=30  # 30% causará crash
```
- **Resultado:** Servicio se reinicia automáticamente
- **Clave:** Eventos NO se reprecesan (idempotencia funciona)
- **Demuestra:** Resiliencia a fallos, deduplicación de eventos
- **Video:** 3 minutos, setup multi-terminal

##### **Modo 3: Timeout (Latencia Alta)**
```bash
FAIL_RESERVE_MODE=timeout
FAIL_RESERVE_PERCENT=40  # 40% de requests tardan 10s+
```
- **Resultado:** Sistema tolera alta latencia gracefully
- **Demuestra:** Timeout handling correcto
- **Video:** Single order timing con `time` command

##### **Modo 4: Retry Manual (Reintentos del Cliente)**
```bash
# Cliente intenta 3 veces
for i in {1..3}; do curl POST /checkout; done
```
- **Resultado:** 3 órdenes creadas (no deduplica a nivel REST)
- **Demuestra:** Comportamiento de reintentos con correlation IDs

#### Script Automatizado

```bash
./docs/chaos-demo.sh  # Ejecuta todos los 4 modos secuencialmente
```

**Qué hace:**
1. Cambia la ENV automáticamente
2. Reinicia servicios
3. Crea 10 órdenes
4. Verifica resultados
5. Reporta summary

---

### 5. **[SCALING.md](./SCALING.md)** - Escalado y Optimización (450 líneas)

#### Niveles de Escalado

| Nivel | Órdenes/día | Réplicas | Particiones | DLQ | Tuning |
|---|---|---|---|---|---|
| **MVP** | 10K | 1 | 1 | ❌ | Básico |
| **Pequeño** | 100K | 3 | 5 | ✅ | Pool, Batching |
| **Mediano** | 1M | 10 | 10 | ✅ | Redis, Prometheus |
| **Grande** | 10M+ | 50+ | 50+ | ✅ | Geo-distributed |

#### 1. Múltiples Réplicas
```yaml
order-service-1:      # Replica A
order-service-2:      # Replica B  
order-service-3:      # Replica C
order-service-lb:     # nginx load balancer
```
**Resultado:** 3x throughput, HA

#### 2. Particiones Kafka
```bash
rpk topic create order.created --partitions 5
```
**Resultado:** 5 consumers procesando en paralelo, 5x lag reduction

#### 3. Dead Letter Queue
```typescript
// Si falla 3 veces → enviar a DLQ
await dlqProducer.send({
  topic: 'order.created-dlq',
  messages: [{ key, value, headers: { 'failed-attempts': '3' } }]
});
```
**Resultado:** No bloquea consumer, admin investigara más tarde

#### 4. Retry Policy
```typescript
// Exponential backoff: 1s, 2s, 4s, 8s...
const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
```
**Resultado:** Resiliencia a fallos temporales

#### 5. Performance Tuning

| Cambio | Antes | Después | Mejora |
|---|---|---|---|
| DB Connection Pool | max 10 | max 50 | 5x |
| Kafka Batching | 1 msg | 100 msgs | 10x |
| Índices BD | ❌ | 3+ índices | 100x en queries |

---

## 🚀 Step-by-Step: De MVP a 100K órdenes/día

### Semana 1: Múltiples Réplicas
```bash
# 1. Agregar 2 más replicas en docker-compose.yml
# 2. Agregar nginx load balancer
# 3. Re-testear con load testing (ab, wrk)

docker-compose up -d

# Verificar que 3 servicios están up
docker ps | grep order-service
```

### Semana 2: Kafka Partitioning
```bash
# 1. Crear topics con 5 particiones
rpk topic create order.created --partitions 5

# 2. No cambios en código (KafkaJS maneja automático)

# 3. Monitorear lag
rpk group describe inventory-service
# LAG debe ser 0
```

### Semana 3: DLQ + Retry Policy
```bash
# 1. Crear topic DLQ
rpk topic create order.created-dlq

# 2. Agregar lógica retry en consumer (ver SCALING.md)

# 3. Monitorear
rpk topic consume order.created-dlq --num 10
```

### Semana 4: Tuning BD y Kafka
```sql
-- Agregar índices
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
```

---

## 📊 Monitoreo en Cada Etapa

### Antes (MVP)
```bash
# Solo logs básicos
tail -f logs/app.log
```

### Después (100K)
```bash
# 1. Consumer lag
watch -n 1 'rpk group describe inventory-service'

# 2. Número de replicas up
watch -n 1 'docker ps | grep order-service | wc -l'

# 3. Throughput
ps aux | grep node | wc -l

# 4. Errores en DLQ
rpk topic consume order.created-dlq
```

---

## 🎓 Matriz de Aprendizaje

| Concepto | Documento | Línea | Ejemplo |
|---|---|---|---|
| Unit Testing | checkout.test.js | 1-360 | MockKafkaProducer |
| Debugging | DEBUGGING.md | 50-150 | Node Inspector setup |
| Logs Estructurados | DEBUGGING.md | 150-270 | Correlation ID tracing |
| Chaos Engineering | CHAOS-SCENARIOS.md | 1-400 | FAIL_RESERVE_MODE |
| Escalado BD | SCALING.md | 300-340 | Connection pooling |
| Escalado Kafka | SCALING.md | 100-180 | 5 particiones |

---

## ✅ Checklist de Implementación

### Fase 1: Testing (✅ Completada)
- [x] Crear test suite con node --test
- [x] MockKafkaProducer implementado
- [x] MockOrderDatabase implementado
- [x] 10 test cases pasando

### Fase 2: Debugging (✅ Completada)
- [x] Node Inspector setup
- [x] Pino logging estructurado
- [x] Correlation ID tracking
- [x] Idempotency verification queries
- [x] Troubleshooting guide

### Fase 3: Observabilidad (✅ Completada)
- [x] httpLogger middleware
- [x] Error logging con stack traces
- [x] Security best practices
- [x] Correlation ID injection

### Fase 4: Chaos Engineering (✅ Completada)
- [x] 4 modos de fallo documentados
- [x] Video scripts con timing
- [x] chaos-demo.sh automatizado
- [x] Monitoring multi-terminal

### Fase 5: Escalado (✅ Completada)
- [x] Múltiples réplicas con load balancer
- [x] Kafka partitioning strategy
- [x] Dead Letter Queue setup
- [x] Retry policy con exponential backoff
- [x] Performance tuning (DB, Kafka)
- [x] Checklist de escalado

---

## 📖 Lectura Recomendada

1. **Empezar:** Leer [TESTING.md](./TESTING.md) - cómo confiar en tu código
2. **Profundizar:** [DEBUGGING.md](./DEBUGGING.md) - cómo encontrar bugs
3. **Experimentar:** [CHAOS-SCENARIOS.md](./CHAOS-SCENARIOS.md) - romp el sistema deliberadamente
4. **Preparar:** [SCALING.md](./SCALING.md) - crecer sin romperse

---

## 🔗 Enlaces Rápidos

- **Test Command:** `npm test`
- **Test Watch:** `npm run test:watch`
- **Debugging Guide:** `docs/DEBUGGING.md`
- **Chaos Demo:** `./docs/chaos-demo.sh`
- **Scaling Plan:** `docs/SCALING.md`
- **HTTP Logger:** `packages/order-service/src/utils/http-logger.ts`

---

**Última actualización:** 2024-01-15  
**Status:** ✅ Completo - Sistema profesional de testing, debugging y escalado
