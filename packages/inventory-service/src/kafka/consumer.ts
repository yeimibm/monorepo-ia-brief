/**
 * Kafka Consumer para Inventory Service
 * Consume: order.created, order.cancelled
 * Publica: inventory.reserved, inventory.rejected, inventory.released
 *
 * Compatible con KafkaJS v2 (consumer.events.*)
 */

import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from '../db/client.js';
import { kafkaProducer } from './producer.js';
import {
  OrderCreatedEvent,
  OrderCancelledEvent,
  InventoryReservedEvent,
  InventoryRejectedEvent,
  InventoryReleasedEvent,
} from '../types/index.js';

class KafkaConsumer {
  private consumer: Consumer;

  constructor() {
    const kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    this.consumer = kafka.consumer({
      groupId: config.kafka.consumerGroups.inventoryService,
      allowAutoTopicCreation: true,
    });

    // ✅ KafkaJS v2: eventos correctos
    this.consumer.on(this.consumer.events.CONNECT, () => {
      logger.info('Consumidor Kafka conectado (Inventory)');
    });

    this.consumer.on(this.consumer.events.DISCONNECT, () => {
      logger.warn('Consumidor Kafka desconectado (Inventory)');
    });

    this.consumer.on(this.consumer.events.CRASH, (e) => {
      logger.error('Consumidor Kafka CRASH (Inventory)', e?.payload?.error || e);
    });

    this.consumer.on(this.consumer.events.REBALANCING, (e) => {
      logger.warn('Consumidor Kafka REBALANCING (Inventory)', { details: e });
    });

    this.consumer.on(this.consumer.events.GROUP_JOIN, (e) => {
      logger.info('Consumidor Kafka GROUP_JOIN (Inventory)', { details: e });
    });
  }

  async start(): Promise<void> {
    try {
      await this.consumer.connect();
      logger.info('✅ Consumidor Kafka conectado');

      await this.consumer.subscribe({
        topics: [config.kafka.topics.orderCreated, config.kafka.topics.orderCancelled],
        fromBeginning: false,
      });

      logger.info('✅ Suscrito a topics de órdenes', {
        topics: [config.kafka.topics.orderCreated, config.kafka.topics.orderCancelled],
      });

      await this.consumer.run({
        eachMessage: this.handleMessage.bind(this),
      });
    } catch (error) {
      logger.error('❌ Error iniciando consumidor', error);
      throw error;
    }
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;

    const correlationId =
      message.headers?.['correlation-id']?.toString() || 'unknown';
    const eventType = message.headers?.['event-type']?.toString() || 'unknown';

    const childLogger = logger.withContext({
      correlationId,
      eventType,
      topic,
      partition,
    });

    try {
      const eventData = JSON.parse(message.value?.toString() || '{}');

      childLogger.info('📨 Mensaje Kafka recibido', {
        orderId: eventData.order_id,
        eventType,
      });

      // Verificar idempotencia
      const alreadyProcessed = await this.isEventProcessed(
        eventData.event_id,
        correlationId
      );

      if (alreadyProcessed) {
        childLogger.warn('⚠️ Evento ya procesado, ignorando', {
          eventId: eventData.event_id,
        });
        return;
      }

      switch (topic) {
        case config.kafka.topics.orderCreated:
          await this.handleOrderCreated(
            eventData as OrderCreatedEvent,
            correlationId,
            childLogger
          );
          break;

        case config.kafka.topics.orderCancelled:
          await this.handleOrderCancelled(
            eventData as OrderCancelledEvent,
            correlationId,
            childLogger
          );
          break;

        default:
          childLogger.warn('⚠️ Topic desconocido', { topic });
      }

      await this.markEventAsProcessed(
        eventData.event_id,
        eventType,
        eventData.order_id,
        correlationId
      );
    } catch (error) {
      childLogger.error('❌ Error procesando mensaje', error);
      // No relanzar para no bloquear consumer
    }
  }

  private async handleOrderCreated(
    event: OrderCreatedEvent,
    correlationId: string,
    log: any
  ): Promise<void> {
    const { order_id, items } = event;

    // SIMULACIÓN DE FALLA (si está configurada)
    if (config.simulation.failReserveMode !== 'none') {
      const shouldFail =
        Math.random() * 100 < config.simulation.failReservePercent;

      if (shouldFail) {
        log.warn('🔴 SIMULANDO FALLA DE RESERVA', {
          mode: config.simulation.failReserveMode,
          percent: config.simulation.failReservePercent,
        });

        if (config.simulation.failReserveMode === 'crash') {
          throw new Error('SIMULATED CRASH');
        }

        if (config.simulation.failReserveMode === 'timeout') {
          await new Promise((resolve) => setTimeout(resolve, 30000));
        }
        // 'reject' sigue para rechazar normalmente
      }
    }

    try {
      const itemsWithStock = await Promise.all(
        items.map(async (item) => {
          const result = await db.query(
            `SELECT available FROM inventory WHERE product_id = $1`,
            [item.product_id],
            correlationId
          );
          const available = result.rows.length > 0 ? result.rows[0].available : 0;

          return { ...item, available };
        })
      );

      log.info('📦 Stock obtenido', {
        orderId: order_id,
        itemsCount: itemsWithStock.length,
      });

      const firstUnavailableItem = itemsWithStock.find(
        (item) => item.available < item.quantity
      );

      // Rechazo por stock insuficiente
      if (firstUnavailableItem || config.simulation.failReserveMode === 'reject') {
        const rejectedEvent: InventoryRejectedEvent = {
          event_id: uuidv4(),
          event_type: 'INVENTORY_REJECTED',
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          order_id,
          reason: firstUnavailableItem ? 'OUT_OF_STOCK' : 'SIMULATED_REJECT',
          details: firstUnavailableItem
            ? {
                product_id: firstUnavailableItem.product_id,
                requested_quantity: firstUnavailableItem.quantity,
                available_quantity: firstUnavailableItem.available,
                message: `No hay suficiente stock.`,
              }
            : { message: 'Rechazo simulado' },
          status: 'REJECTED',
        };

        await kafkaProducer.publishInventoryRejected(rejectedEvent, correlationId);
        log.warn('❌ Inventario rechazado', { orderId: order_id });
        return;
      }

      // Reservar stock
      log.info('✅ Stock disponible, reservando...', {
        orderId: order_id,
        itemsCount: items.length,
      });

      const client = await db.beginTransaction(correlationId);
      const reservationId = uuidv4();

      try {
        const reservedItems: any[] = [];

        for (const item of items) {
          // Obtener el ID real de inventory basado en product_id
          const inventoryResult = await client.query(
            `SELECT id FROM inventory WHERE product_id = $1`,
            [item.product_id]
          );

          if (inventoryResult.rows.length === 0) {
            throw new Error(
              `Inventory not found for product_id: ${item.product_id}`
            );
          }

          const inventoryId = inventoryResult.rows[0].id;

          await client.query(
            `UPDATE inventory 
             SET available = available - $1, reserved = reserved + $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [item.quantity, inventoryId]
          );

          await client.query(
            `INSERT INTO reserved_items (id, reservation_id, product_id, quantity, status, expired_at)
             VALUES ($1, $2, $3, $4, 'RESERVED', $5)`,
            [uuidv4(), reservationId, inventoryId, item.quantity, null]
          );

          reservedItems.push({
            product_id: item.product_id,
            quantity: item.quantity,
            reserved_quantity: item.quantity,
            expiration_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          });

          log.debug('✅ Item reservado', {
            orderId: order_id,
            productId: item.product_id,
            quantity: item.quantity,
          });
        }

        await client.query(
          `INSERT INTO inventory_events (id, product_id, event_type, order_id, correlation_id, payload)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            uuidv4(),
            items[0].product_id,
            'INVENTORY_RESERVED',
            order_id,
            correlationId,
            JSON.stringify({ reservation_id: reservationId, items: reservedItems }),
          ]
        );

        await db.commit(client, correlationId);

        const reservedEvent: InventoryReservedEvent = {
          event_id: uuidv4(),
          event_type: 'INVENTORY_RESERVED',
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          order_id,
          reservation_id: reservationId,
          items: reservedItems,
          status: 'RESERVED',
        };

        await kafkaProducer.publishInventoryReserved(reservedEvent, correlationId);

        log.info('✅ Inventario reservado', {
          orderId: order_id,
          reservationId,
        });
      } catch (txError) {
        await db.rollback(client, correlationId);
        throw txError;
      }
    } catch (error) {
      log.error('❌ Error procesando order.created', error, { orderId: order_id });
      throw error;
    }
  }

  private async handleOrderCancelled(
    event: OrderCancelledEvent,
    correlationId: string,
    log: any
  ): Promise<void> {
    const { order_id } = event;

    try {
      log.info('🔄 Liberando inventario por cancelación', { orderId: order_id });

      // OJO: tu query original parece rara, pero la dejo como estaba para no romper lógica
      const result = await db.query(
        `SELECT ri.product_id, ri.quantity 
         FROM reserved_items ri
         WHERE ri.reservation_id LIKE $1
         AND ri.status = 'RESERVED'`,
        [order_id + '%'],
        correlationId
      );

      const reservedItems = result.rows;

      if (reservedItems.length === 0) {
        log.warn('⚠️ No hay items reservados para esta orden', { orderId: order_id });
        return;
      }

      const client = await db.beginTransaction(correlationId);

      try {
        for (const item of reservedItems) {
          await client.query(
            `UPDATE inventory 
             SET available = available + $1, reserved = reserved - $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [item.quantity, item.product_id]
          );

          await client.query(
            `UPDATE reserved_items 
             SET status = 'RELEASED'
             WHERE reservation_id LIKE $1 AND product_id = $2`,
            [order_id + '%', item.product_id]
          );

          log.debug('✅ Item liberado', {
            orderId: order_id,
            productId: item.product_id,
            quantity: item.quantity,
          });
        }

        await db.commit(client, correlationId);

        const releasedEvent: InventoryReleasedEvent = {
          event_id: uuidv4(),
          event_type: 'INVENTORY_RELEASED',
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          order_id,
          items: reservedItems,
        };

        await kafkaProducer.publishInventoryReleased(releasedEvent, correlationId);

        log.info('✅ Inventario liberado', { orderId: order_id });
      } catch (txError) {
        await db.rollback(client, correlationId);
        throw txError;
      }
    } catch (error) {
      log.error('❌ Error procesando order.cancelled', error, { orderId: order_id });
      throw error;
    }
  }

  private async isEventProcessed(eventId: string, correlationId: string): Promise<boolean> {
    try {
      const result = await db.query(
        `SELECT 1 FROM processed_events WHERE event_id = $1`,
        [eventId],
        correlationId
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('❌ Error verificando evento', error);
      return false;
    }
  }

  private async markEventAsProcessed(
    eventId: string,
    eventType: string,
    orderId: string,
    correlationId: string
  ): Promise<void> {
    try {
      await db.query(
        `INSERT INTO processed_events (event_id, event_type, order_id, correlation_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, eventType, orderId, correlationId],
        correlationId
      );
    } catch (error) {
      logger.error('❌ Error marcando evento', error);
    }
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
    logger.info('Consumidor Kafka desconectado');
  }
}

export const kafkaConsumer = new KafkaConsumer();