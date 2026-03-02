/**
 * Tests para Order Service - POST /checkout
 * Ejecutar: npm test (desde packages/order-service)
 *
 * Este archivo usa Node.js Test Runner nativo (—test)
 * https://nodejs.org/api/test.html
 */

import test from 'node:test';
import assert from 'node:assert';

// Mock de Producer para Kafka
class MockKafkaProducer {
  constructor() {
    this.publishedEvents = [];
    this.isConnected = true;
  }

  async send(record) {
    if (!this.isConnected) {
      throw new Error('Kafka producer no conectado');
    }
    this.publishedEvents.push(record);
    return [{ topicName: record.topic, partition: 0, offset: this.publishedEvents.length - 1 }];
  }

  async connect() {
    this.isConnected = true;
  }

  async disconnect() {
    this.isConnected = false;
  }

  // Utility para tests
  getPublishedEvents(topic) {
    return this.publishedEvents.filter(e => e.topic === topic);
  }

  clear() {
    this.publishedEvents = [];
  }
}

// Mock de Database Client para órdenes
class MockOrderDatabase {
  constructor() {
    this.orders = new Map();
    this.isConnected = true;
  }

  async createOrder(orderId, productId, quantity, correlationId) {
    if (!this.isConnected) {
      throw new Error('Base de datos no conectada');
    }

    const order = {
      id: orderId,
      product_id: productId,
      quantity,
      status: 'PENDING',
      correlation_id: correlationId,
      created_at: new Date().toISOString(),
    };

    this.orders.set(orderId, order);
    return order;
  }

  async getOrder(orderId) {
    return this.orders.get(orderId) || null;
  }

  async updateOrderStatus(orderId, newStatus) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Orden ${orderId} no encontrada`);
    order.status = newStatus;
    return order;
  }

  clear() {
    this.orders.clear();
  }
}

// Mock handler para POST /checkout (simula la lógica real)
async function handleCheckout(db, producer, { productId, quantity, customerName, correlationId }) {
  // Validación
  if (!productId || !quantity || quantity <= 0) {
    const error = new Error('Validación falló: product_id y quantity requeridos');
    error.status = 400;
    throw error;
  }

  // Generar UUID (simplificado para test)
  const orderId = `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // 1. Crear orden en BD
  const order = await db.createOrder(orderId, productId, quantity, correlationId);

  // 2. Publicar evento en Kafka
  const orderCreatedEvent = {
    topic: 'order.created',
    messages: [
      {
        key: orderId,
        value: JSON.stringify({
          event_type: 'order.created',
          event_id: `event-${Date.now()}`,
          order_id: orderId,
          product_id: productId,
          quantity,
          customer_name: customerName,
          correlation_id: correlationId,
          timestamp: new Date().toISOString(),
        }),
      },
    ],
  };

  await producer.send(orderCreatedEvent);

  return {
    order_id: orderId,
    status: order.status,
    product_id: productId,
    quantity,
  };
}

// ============================================
// TESTS SUITE: POST /checkout
// ============================================

test('POST /checkout - Happy Path: crea orden y publica evento', async (t) => {
  await t.test('Debe crear orden en estado PENDING', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();

    const result = await handleCheckout(db, producer, {
      productId: 'LAPTOP-001',
      quantity: 2,
      customerName: 'Test User',
      correlationId: 'test-corr-001',
    });

    // Validaciones
    assert.strictEqual(result.status, 'PENDING', 'Estado debe ser PENDING');
    assert.strictEqual(result.product_id, 'LAPTOP-001', 'product_id debe coincidir');
    assert.strictEqual(result.quantity, 2, 'quantity debe coincidir');
    assert.ok(result.order_id, 'order_id debe existir');
  });

  await t.test('Debe publicar evento order.created en Kafka', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();

    const result = await handleCheckout(db, producer, {
      productId: 'PHONE-001',
      quantity: 1,
      customerName: 'Alice',
      correlationId: 'test-corr-002',
    });

    // Verificar que el evento fue publicado
    const publishedEvents = producer.getPublishedEvents('order.created');
    assert.strictEqual(publishedEvents.length, 1, 'Debe haber 1 evento publicado');

    // Verificar contenido del evento
    const event = JSON.parse(publishedEvents[0].messages[0].value);
    assert.strictEqual(event.event_type, 'order.created', 'event_type debe ser order.created');
    assert.strictEqual(event.order_id, result.order_id, 'order_id debe coincidir');
    assert.strictEqual(event.correlation_id, 'test-corr-002', 'correlation_id debe propagarse');
  });

  await t.test('Debe persistir orden en BD y poder recuperarla', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();

    const result = await handleCheckout(db, producer, {
      productId: 'TABLET-001',
      quantity: 3,
      customerName: 'Bob',
      correlationId: 'test-corr-003',
    });

    // Recuperar orden de BD
    const storedOrder = await db.getOrder(result.order_id);
    assert.ok(storedOrder, 'Orden debe existir en BD');
    assert.strictEqual(storedOrder.status, 'PENDING', 'Status debe ser PENDING');
    assert.strictEqual(storedOrder.quantity, 3, 'Quantity debe coincidir');
  });

  await t.test('Debe incluir correlation_id en BD y evento', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();
    const correlationId = 'debug-trace-123';

    const result = await handleCheckout(db, producer, {
      productId: 'CAMERA-001',
      quantity: 1,
      customerName: 'Charlie',
      correlationId,
    });

    // Verificar en BD
    const storedOrder = await db.getOrder(result.order_id);
    assert.strictEqual(storedOrder.correlation_id, correlationId, 'correlation_id en BD');

    // Verificar en evento
    const events = producer.getPublishedEvents('order.created');
    const event = JSON.parse(events[0].messages[0].value);
    assert.strictEqual(event.correlation_id, correlationId, 'correlation_id en evento');
  });
});

test('POST /checkout - Validación y Errores', async (t) => {
  await t.test('Debe rechazar si product_id está vacío', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();

    try {
      await handleCheckout(db, producer, {
        productId: '',
        quantity: 1,
        customerName: 'Test',
        correlationId: 'test-err-001',
      });
      assert.fail('Debería lanzar error');
    } catch (error) {
      assert.strictEqual(error.status, 400, 'Debe retornar 400');
      assert.match(error.message, /Validación falló/);
    }
  });

  await t.test('Debe rechazar si quantity es 0 o negativo', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();

    try {
      await handleCheckout(db, producer, {
        productId: 'LAPTOP-001',
        quantity: -5,
        customerName: 'Test',
        correlationId: 'test-err-002',
      });
      assert.fail('Debería lanzar error');
    } catch (error) {
      assert.strictEqual(error.status, 400);
    }
  });

  await t.test('Debe fallar si BD no está conectada', async () => {
    const db = new MockOrderDatabase();
    db.isConnected = false;
    const producer = new MockKafkaProducer();

    try {
      await handleCheckout(db, producer, {
        productId: 'LAPTOP-001',
        quantity: 1,
        customerName: 'Test',
        correlationId: 'test-err-003',
      });
      assert.fail('Debería lanzar error');
    } catch (error) {
      assert.match(error.message, /Base de datos no conectada/);
    }
  });

  await t.test('Debe fallar si Kafka no está conectado', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();
    producer.isConnected = false;

    try {
      await handleCheckout(db, producer, {
        productId: 'LAPTOP-001',
        quantity: 1,
        customerName: 'Test',
        correlationId: 'test-err-004',
      });
      assert.fail('Debería lanzar error');
    } catch (error) {
      assert.match(error.message, /Kafka producer no conectado/);
    }
  });
});

test('POST /checkout - Idempotencia (multiples requests)', async (t) => {
  await t.test('Ordenes diferentes tienen order_id diferentes', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();

    const result1 = await handleCheckout(db, producer, {
      productId: 'LAPTOP-001',
      quantity: 1,
      customerName: 'User1',
      correlationId: 'test-idempotent-001',
    });

    const result2 = await handleCheckout(db, producer, {
      productId: 'LAPTOP-001',
      quantity: 1,
      customerName: 'User2',
      correlationId: 'test-idempotent-002',
    });

    assert.notStrictEqual(result1.order_id, result2.order_id, 'Cada orden debe tener ID único');
  });

  await t.test('Multiples ordenes se publican como eventos separados', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();

    for (let i = 0; i < 5; i++) {
      await handleCheckout(db, producer, {
        productId: `PRODUCT-${i}`,
        quantity: 1,
        customerName: `User${i}`,
        correlationId: `test-multi-${i}`,
      });
    }

    const events = producer.getPublishedEvents('order.created');
    assert.strictEqual(events.length, 5, 'Debe haber 5 eventos');
  });
});

test('POST /checkout - Validación de timestamps', async (t) => {
  await t.test('Orden creada debe tener timestamp válido', async () => {
    const db = new MockOrderDatabase();
    const producer = new MockKafkaProducer();

    const beforeTime = new Date();
    const result = await handleCheckout(db, producer, {
      productId: 'TEST-001',
      quantity: 1,
      customerName: 'Test',
      correlationId: 'test-time-001',
    });
    const afterTime = new Date();

    const order = await db.getOrder(result.order_id);
    const createdTime = new Date(order.created_at);

    assert.ok(createdTime >= beforeTime, 'Timestamp debe ser >= beforeTime');
    assert.ok(createdTime <= afterTime, 'Timestamp debe ser <= afterTime');
  });
});
