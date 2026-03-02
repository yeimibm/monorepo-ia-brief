# 🔍 Guía de Monitoreo de Logs en Tiempo Real

**Objetivo:** Ver exactamente qué está pasando en cada servicio mientras una petición viaja por la arquitectura.

---

## 📱 Setup: 4 Ventanas Abiertas Simultáneamente

Para obtener la mejor experiencia, necesitas ver logs en paralelo:

```
┌─────────────────────────────────────────────────────┐
│  VENTANA 1         │  VENTANA 2       │  VENTANA 3   │
│  Order-Service     │  Inventory-     │  Kafka Logs  │
│  Logs              │  Service Logs    │              │
├────────────────────┼──────────────────┼──────────────┤
│ (logs aquí)        │ (logs aquí)      │ (logs aquí)  │
│                    │                  │              │
│                    │                  │              │
└────────────────────┴──────────────────┴──────────────┘
         ↓                  ↓                ↓
      (esperas y           (esperas y      (esperas y
       observas)           observas)        observas)

┌──────────────────────────────────────────────────────┐
│  VENTANA 4 (Postman en navegador)                    │
│  ┌────────────────────────────────────────────────┐  │
│  │ POST /checkout                                  │  │
│  │ Body: {product_id: LAPTOP, quantity: 2}        │  │
│  │ [SEND] → Observar respuesta                     │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

---

## 🟦 VENTANA 1: Order Service Logs

### Abrir terminal y ejecutar:

```bash
docker logs order-service -f --tail 30
```

**Parámetros explicados:**
- `-f`: Follow (seguir logs en tiempo real)
- `--tail 30`: Mostrar últimas 30 líneas

**Salida esperada cuando hayas enviado petición desde Postman:**

```json
{"level":30,"time":1709433245000,"color":"green","msg":"📨 HTTP REQUEST","method":"POST","path":"/checkout","correlation_id":"req-checkout-001"}

{"level":30,"time":1709433245010,"color":"cyan","msg":"🔍 Validating checkout request...","product_id":"LAPTOP","quantity":2}

{"level":30,"time":1709433245020,"color":"cyan","msg":"📝 Creating order in database...","customer_id":"550e8400-e29b-41d4-a716-446655440100"}

{"level":30,"time":1709433245050,"msg":"✅ Order created successfully","order_id":"550e8400-e29b-41d4-a716-446655440002","status":"PENDING"}

{"level":30,"time":1709433245055,"color":"yellow","msg":"📤 Publishing event to Kafka","event":"order.created","topic":"order.created","correlation_id":"req-checkout-001"}

{"level":30,"time":1709433245100,"msg":"✅ Event published successfully","message_id":"msg-uuid-123"}

{"level":30,"time":1709433245150,"color":"blue","msg":"⏳ Waiting for inventory response...","timeout_ms":30000}
```

**Esperar ~1-5 segundos más... luego:**

```json
{"level":30,"time":1709433245450,"msg":"📥 Received event from Kafka","event":"inventory.reserved","correlation_id":"req-checkout-001"}

{"level":30,"time":1709433245460,"color":"green","msg":"✅ Order status updated to CONFIRMED"}

{"level":30,"time":1709433245470,"msg":"📤 HTTP RESPONSE","status":200,"response_time_ms":470}
```

---

## 🟩 VENTANA 2: Inventory Service Logs

### Abrir terminal y ejecutar:

```bash
docker logs inventory-service -f --tail 30
```

**Salida esperada (casi simultáneamente con VENTANA 1 pero ~100-200ms después):**

```json
{"level":30,"time":1709433245250,"color":"blue","msg":"📥 Kafka Consumer Message Received","topic":"order.created","partition":0}

{"level":30,"time":1709433245260,"msg":"🔍 Processing order event","event_id":"evt-uuid-123","product_id":"LAPTOP","quantity":2,"correlation_id":"req-checkout-001"}

{"level":30,"time":1709433245270,"color":"cyan","msg":"🔎 Checking inventory availability...","product_id":"LAPTOP","required_quantity":2}

{"level":30,"time":1709433245280,"msg":"📊 Current inventory state","available":10,"reserved":0,"required":2}

{"level":30,"time":1709433245285,"color":"green","msg":"✅ Stock available! Reserving...","reserved_quantity":2}

{"level":30,"time":1709433245295,"msg":"📝 Updating inventory in database..."}

{"level":30,"time":1709433245310,"msg":"✅ Inventory reserved successfully"}

{"level":30,"time":1709433245320,"color":"yellow","msg":"📤 Publishing inventory.reserved event","correlation_id":"req-checkout-001","message_id":"msg-uuid-456"}

{"level":30,"time":1709433245350,"msg":"✅ Event published to Kafka"}

{"level":30,"time":1709433245360,"msg":"💾 Marking event as processed (idempotency)","event_id":"evt-uuid-123"}
```

---

## 🔴 VENTANA 3: Kafka Broker Logs

### Abrir terminal y ejecutar:

```bash
docker logs kafka-broker -f --tail 50 | grep -i "message\|produce\|replica"
```

**Salida esperada (más técnica, enfocado en broker operations):**

```
[2026-03-02 00:15:45,123] INFO Processing FetchRequest...
[2026-03-02 00:15:45,125] INFO [SocketServer brokerId=1] Received...
[2026-03-02 00:15:45,150] INFO Appended... (for topic: order.created, partition: 0)
[2026-03-02 00:15:45,250] INFO [Replica Manager...
[2026-03-02 00:15:45,350] INFO Appended... (for topic: inventory.reserved, partition: 0)
```

**Más importante:** Ver qué tópicos tienen mensajes:

```bash
docker exec kafka-broker kafka-topics \
  --bootstrap-server localhost:9092 \
  --list
```

**Output:**
```
__consumer_offsets
inventory.created
inventory.rejected
inventory.reserved
order.cancelled
order.created
```

---

## 🖥️ VENTANA 4: Postman (Navegador)

### Acciones:

1. **Antes de enviar:**
   - Ya tienes Terminal 1, 2, 3 viendo logs
   - Haz clic en las 3 terminales para que estén visibles(arrange windows)

2. **Enviar petición:**
   ```
   POST http://localhost:3001/checkout
   Body: {
     "product_id": "LAPTOP",
     "quantity": 2,
     "customer_id": "550e8400-e29b-41d4-a716-446655440100"
   }
   Headers:
     - X-Correlation-Id: req-checkout-001
   ```

3. **Observar:**
   - Ve a Terminal 1 → ves `POST /checkout` recibida
   - Ve a Terminal 2 → ves `order.created` consumida
   - Ve a Terminal 3 → ve mensajes en Kafka
   - Ve a Terminal 2 → ves `inventory.reserved` publicado
   - Ve a Terminal 1 → ves respuesta 200

4. **Obtener respuesta en Postman:**
   ```json
   {
     "status": "success",
     "order_id": "550e8400-e29b-41d4-a716-446655440002",
     "status_code": 200
   }
   ```

---

## 🎯 Mapear Flujo Completo (Timeline)

Copia esta tabla en un documento y llena con tus timestamps:

| Tiempo (ms) | Servicio | Acción | Log esperado |
|--|--|--|--|
| 0ms | Postman | Envía POST | _esperando respuesta_ |
| +5ms | Order-Service | Recibe | `📨 HTTP REQUEST` |
| +10ms | Order-Service | Valida | `🔍 Validating...` |
| +20ms | Order-Service | BD INSERT | `📝 Creating order...` |
| +50ms | Order-Service | Orden creada | `✅ Order created` |
| +55ms | Order-Service | Publica | `📤 Publishing event...` |
| +100ms | Kafka | Almacena | _(logs en Terminal 3)_ |
| +150ms | Inventory-Service | Consume | `📥 Kafka Consumer...` |
| +160ms | Inventory-Service | Procesa | `🔍 Checking inventory...` |
| +280ms | Inventory-Service | Revisa BD | `📊 Current inventory...` |
| +285ms | Inventory-Service | Reserva | `✅ Stock available!` |
| +310ms | Inventory-Service | Publica | `📤 Publishing inventory...` |
| +350ms | Kafka | Almacena | _(logs en Terminal 3)_ |
| +400ms | Order-Service | Consume | `📥 Received event from Kafka` |
| +450ms | Order-Service | Actualiza | `✅ Order status updated` |
| +470ms | Postman | Respuesta | `200 OK` ✅ |

**Tiempo total esperado: 400-500ms**

---

## 🔴 Escenario: Stock Insuficiente (ver diferencia)

**Enviar:**
```json
{
  "product_id": "LAPTOP",
  "quantity": 999,
  "customer_id": "550e8400-e29b-41d4-a716-446655440101"
}
```

**VENTANA 2 muestra diferencia:**
```json
// ❌ En lugar de:
{"level":30,"color":"green","msg":"✅ Stock available! Reserving..."}

// Ve esto:
{"level":30,"color":"red","msg":"❌ Insufficient stock!","available":10,"required":999}

{"level":30,"msg":"📤 Publishing inventory.REJECTED event"}
```

**VENTANA 1 recibe:**
```json
{"level":30,"msg":"📥 Received event from Kafka","event":"inventory.rejected"}
{"level":30,"color":"red","msg":"❌ Order status updated to REJECTED"}
```

**Postman recibe:**
```json
{
  "status": "error",
  "order_id": "...",
  "status": "REJECTED",
  "message": "Insufficient inventory"
}
```

---

## 🔑 Rastrear Correlation ID

**Comando:** Buscar en logs por correlation_id

```bash
# Terminal 1:
docker logs order-service | grep "req-checkout-001"

# Terminal 2:
docker logs inventory-service | grep "req-checkout-001"
```

**Output:**
```
✅ Ambas terminales muestran el MISMO correlation_id
→ Así sabes que logs pertenecen a la MISMA petición
```

---

## 💾 Ver Cambios en Base de Datos

**En paralelo a los logs, abrir otra terminal:**

```bash
# Terminal 5: Monitorear órdenes
docker exec -it orders-postgres psql -U orders_user -d orders_db -c "SELECT id, customer_id, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5;"

# Ejecutar en bucle cada 2 segundos
watch -n 2 'docker exec -it orders-postgres psql -U orders_user -d orders_db -c "SELECT id, customer_id, status FROM orders ORDER BY created_at DESC LIMIT 5;"'
```

**Ver estado cambiar:**
```
Antes:    status = PENDING
↓ (espera 500ms)
Después:  status = CONFIRMED  ✅
```

---

## 🎬 Escenario Completo: Paso a Paso

### Preparación (5 minutos)

```bash
# 1. Abrir Tab/Ventana 1
docker logs order-service -f --tail 30

# 2. Abrir Tab/Ventana 2  
docker logs inventory-service -f --tail 30

# 3. Abrir Tab/Ventana 3
docker logs kafka-broker -f --tail 50

# 4. Abrir Tab/Ventana 4
# Postman o navegador

# 5. Abrir Tab/Ventana 5 (verificar BD)
docker exec -it orders-postgres psql -U orders_user -d orders_db
SELECT id, status FROM orders ORDER BY created_at DESC LIMIT 5;
\watch 2
```

### Ejecución (1 minuto)

1. Mira con atención todos los logs montados
2. En Postman, haz POST /checkout
3. **Pausa mental:** Observa qué sucede en cada ventana
4. Escribe las líneas de tiempo
5. Repite con diferentes product_ids

### Análisis (5 minutos)

- ¿A qué hora se creó la orden?
- ¿Cuándo se publicó el evento?
- ¿Cuándo lo consumió inventory-service?
- ¿Cuánto tiempo esperó order-service?
- ¿Fue el tiempo total <500ms?

---

## 📊 Tabla Resumen para Documentar

Crea un documento y rellena esto cada vez que pruebes:

```markdown
## Test #1: Checkout LAPTOP x2

| Métrica | Valor | Observación |
|---------|-------|------------|
| Correlation ID | req-checkout-001 | ✅ Aparece en ambos servicios |
| Orden creada en BD | 2026-03-02 00:15:45.050 | ✅ Timestamp coincide con logs |
| Evento publicado | +55ms | Rápido ✅ |
| Inventario actualizado | +285ms | Dentro de lo esperado |
| Respuesta a Postman | +470ms | <500ms ✅ |
| Stock final | LAPTOP: 8/10 | ✅ Correcto (10-2) |
```

---

## 🚨 Troubleshooting: Qué buscar en logs

### "Postman espera forever (no recibe respuesta)"

**En VENTANA 1, busca:**
- ❌ Error: `PublishError: Failed to publish`
- ❌ Error: `DatabaseError`
- ❌ Nunca aparece: `"📥 Received event from Kafka"`

**Solución:**
```bash
# Revisar servicio está vivo
docker ps | grep order-service

# Ver últimos errores completos
docker logs order-service --tail 100 | tail -20
```

### "VENTANA 2 no muestra logs"

**Verificar:**
```bash
# ¿Está corriendo?
docker ps | grep inventory-service

# ¿Se está suscribiendo a Kafka?
docker logs inventory-service | grep "Kafka"

# ¿Hay offset issues?
docker logs inventory-service | grep "offset" 
```

### "Orden se crea pero jamás se actualiza"

**En VENTANA 1 buscar:**
```
📥 Received event from Kafka → ❌ NO APARECE
```

**Probabilidad:** Kafka no envía evento, o consumer no recibe

**Verificar:**
```bash
# Ver tópicos
docker exec kafka-broker kafka-topics --bootstrap-server localhost:9092 --list

# Ver mensajes en tópico
docker exec kafka-broker kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic order.created \
  --from-beginning
```

---

## 🎓 Lecciones Clave

Después de hacer esto 3-5 veces, deberías entender:

✅ Cómo correlation_id rastrea una petición  
✅ Por qué el sistema es asincrónico (Kafka en el medio)  
✅ Qué tanta latencia agrega cada servicio  
✅ Cómo se actualiza el estado sin HTTP request  
✅ Por qué la idempotencia es crítica  

---

**Próximo paso:** Abre este documento y un terminal al lado, y sigue los pasos.
