/**
 * Kafka Producer para Inventory Service
 * Compatible con KafkaJS v2
 */

import { Kafka, Producer, Partitioners } from 'kafkajs';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  InventoryReservedEvent,
  InventoryRejectedEvent,
  InventoryReleasedEvent,
} from '../types/index.js';

class KafkaProducer {
  private producer: Producer;

  constructor() {
    const kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    // Usamos LegacyPartitioner para evitar warning
    this.producer = kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
    });

    // KafkaJS v2 usa producer.events.*
    this.producer.on(this.producer.events.CONNECT, () => {
      logger.info('Productor Kafka conectado (Inventory)');
    });

    this.producer.on(this.producer.events.DISCONNECT, () => {
      logger.warn('Productor Kafka desconectado (Inventory)');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.producer.connect();
      logger.info('Productor Kafka conectado');
    } catch (error) {
      logger.error('Error conectando Productor', error);
      throw error;
    }
  }

  async publishInventoryReserved(
    event: InventoryReservedEvent,
    correlationId: string
  ): Promise<void> {
    await this.producer.send({
      topic: config.kafka.topics.inventoryReserved,
      messages: [
        {
          key: event.order_id,
          value: JSON.stringify(event),
          headers: {
            'correlation-id': correlationId,
            'event-type': 'INVENTORY_RESERVED',
          },
        },
      ],
    });

    logger.info('inventory.reserved publicado', {
      correlationId,
      orderId: event.order_id,
    });
  }

  async publishInventoryRejected(
    event: InventoryRejectedEvent,
    correlationId: string
  ): Promise<void> {
    await this.producer.send({
      topic: config.kafka.topics.inventoryRejected,
      messages: [
        {
          key: event.order_id,
          value: JSON.stringify(event),
          headers: {
            'correlation-id': correlationId,
            'event-type': 'INVENTORY_REJECTED',
          },
        },
      ],
    });

    logger.info('inventory.rejected publicado', {
      correlationId,
      orderId: event.order_id,
    });
  }

  async publishInventoryReleased(
    event: InventoryReleasedEvent,
    correlationId: string
  ): Promise<void> {
    await this.producer.send({
      topic: config.kafka.topics.inventoryReleased,
      messages: [
        {
          key: event.order_id,
          value: JSON.stringify(event),
          headers: {
            'correlation-id': correlationId,
            'event-type': 'INVENTORY_RELEASED',
          },
        },
      ],
    });

    logger.info('inventory.released publicado', {
      correlationId,
      orderId: event.order_id,
    });
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
    logger.info('Productor Kafka desconectado');
  }
}

export const kafkaProducer = new KafkaProducer();