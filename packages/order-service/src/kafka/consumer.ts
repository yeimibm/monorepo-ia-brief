/**
 * Kafka Consumer para Order Service
 * Consume: inventory.reserved, inventory.rejected, inventory.released
 * Actualiza estado de órdenes basado en respuestas del inventario
 *
 * Compatible con KafkaJS v2 (consumer.events.*)
 */

import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from '../db/client.js';
import {
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
      groupId: config.kafka.consumerGroups.orderService,
      allowAutoTopicCreation: true,
    });

    // ✅ KafkaJS v2: eventos correctos
    this.consumer.on(this.consumer.events.CONNECT, () => {
      logger.info('Consumidor Kafka conectado (Order)');
    });

    this.consumer.on(this.consumer.events.DISCONNECT, () => {
      logger.warn('Consumidor Kafka desconectado (Order)');
    });

    this.consumer.on(this.consumer.events.CRASH, (e) => {
      logger.error('Consumidor Kafka CRASH (Order)', e?.payload?.error || e);
    });

    this.consumer.on(this.consumer.events.REBALANCING, (e) => {
      logger.warn('Consumidor Kafka REBALANCING (Order)', { details: e });
    });

    this.consumer.on(this.consumer.events.GROUP_JOIN, (e) => {
      logger.info('Consumidor Kafka GROUP_JOIN (Order)', { details: e });
    });
  }

  async start(): Promise<void> {
    try {
      await this.consumer.connect();
      logger.info('✅ Consumidor Kafka conectado');

      await this.consumer.subscribe({
        topics: [
          config.kafka.topics.inventoryReserved,
          config.kafka.topics.inventoryRejected,
          config.kafka.topics.inventoryReleased,
        ],
        fromBeginning: false,
      });

      logger.info('✅ Suscrito a topics de inventario', {
        topics: [
          config.kafka.topics.inventoryReserved,
          config.kafka.topics.inventoryRejected,
          config.kafka.topics.inventoryReleased,
        ],
      });

      await this.consumer.run({
        eachMessage: this.handleMessage.bind(this),
      });
    } catch (error) {
      logger.error('❌ Error iniciando consumidor Kafka', error);
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
        case config.kafka.topics.inventoryReserved:
          await this.handleInventoryReserved(
            eventData as InventoryReservedEvent,
            correlationId,
            childLogger
          );
          break;

        case config.kafka.topics.inventoryRejected:
          await this.handleInventoryRejected(
            eventData as InventoryRejectedEvent,
            correlationId,
            childLogger
          );
          break;

        case config.kafka.topics.inventoryReleased:
          await this.handleInventoryReleased(
            eventData as InventoryReleasedEvent,
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
      childLogger.error('❌ Error procesando mensaje Kafka', error);
      // no relanzar
    }
  }

  private async handleInventoryReserved(
    event: InventoryReservedEvent,
    correlationId: string,
    log: any
  ): Promise<void> {
    const { order_id, reservation_id } = event;

    const result = await db.query(
      `UPDATE orders 
       SET status = 'CONFIRMED', 
           inventory_response_received_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'PENDING'
       RETURNING *`,
      [order_id],
      correlationId
    );

    if (result.rows.length === 0) {
      log.warn('⚠️ Orden no encontrada o ya procesada', { orderId: order_id });
      return;
    }

    log.info('✅ Orden confirmada', {
      orderId: order_id,
      reservationId: reservation_id,
      status: 'CONFIRMED',
    });
  }

  private async handleInventoryRejected(
    event: InventoryRejectedEvent,
    correlationId: string,
    log: any
  ): Promise<void> {
    const { order_id, reason, details } = event;

    const result = await db.query(
      `UPDATE orders 
       SET status = 'REJECTED', 
           inventory_response_received_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'PENDING'
       RETURNING *`,
      [order_id],
      correlationId
    );

    if (result.rows.length === 0) {
      log.warn('⚠️ Orden no encontrada o ya procesada', { orderId: order_id });
      return;
    }

    log.info('✅ Orden rechazada', {
      orderId: order_id,
      reason,
      details,
      status: 'REJECTED',
    });
  }

  private async handleInventoryReleased(
    event: InventoryReleasedEvent,
    correlationId: string,
    log: any
  ): Promise<void> {
    const { order_id } = event;

    await db.query(
      `INSERT INTO order_events (id, order_id, event_type, correlation_id, payload)
       VALUES (gen_random_uuid(), $1, 'INVENTORY_RELEASED', $2, $3)`,
      [order_id, correlationId, JSON.stringify(event)],
      correlationId
    );

    log.info('✅ Liberación de inventario registrada', { orderId: order_id });
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
      logger.error('❌ Error verificando evento procesado', error);
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
      logger.error('❌ Error marcando evento como procesado', error);
    }
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
    logger.info('Consumidor Kafka desconectado');
  }
}

export const kafkaConsumer = new KafkaConsumer();