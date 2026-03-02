/**
 * Kafka Producer para Order Service
 * Compatible con KafkaJS v2
 */

import { Kafka, Producer, Partitioners } from 'kafkajs';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  OrderCreatedEvent,
  OrderCancelledEvent,
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

    this.producer = kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
    });

    this.producer.on(this.producer.events.CONNECT, () => {
      logger.info('Productor Kafka conectado (Order)');
    });

    this.producer.on(this.producer.events.DISCONNECT, () => {
      logger.warn('Productor Kafka desconectado (Order)');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.producer.connect();
      logger.info('Productor Kafka conectado');
    } catch (error) {
      logger.error('Error conectando Productor Kafka', error);
      throw error;
    }
  }

  async publishOrderCreated(
    event: OrderCreatedEvent,
    correlationId: string
  ): Promise<void> {
    await this.producer.send({
      topic: config.kafka.topics.orderCreated,
      messages: [
        {
          key: event.order_id,
          value: JSON.stringify(event),
          headers: {
            'correlation-id': correlationId,
            'event-type': 'ORDER_CREATED',
          },
        },
      ],
    });

    logger.info('order.created publicado', {
      correlationId,
      orderId: event.order_id,
    });
  }

  async publishOrderCancelled(
    event: OrderCancelledEvent,
    correlationId: string
  ): Promise<void> {
    await this.producer.send({
      topic: config.kafka.topics.orderCancelled,
      messages: [
        {
          key: event.order_id,
          value: JSON.stringify(event),
          headers: {
            'correlation-id': correlationId,
            'event-type': 'ORDER_CANCELLED',
          },
        },
      ],
    });

    logger.info('order.cancelled publicado', {
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