/**
 * Handler: POST /checkout
 * Crear una nueva orden
 */

import { Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/client.js';
import { kafkaProducer } from '../kafka/producer.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import {
  CheckoutRequest,
  Order,
  OrderCreatedEvent,
  ApiResponse,
} from '../types/index.js';

/**
 * POST /checkout
 * Crear orden y publicar evento
 *
 * Request body:
 * {
 *   "customer_id": "uuid",
 *   "items": [
 *     { "product_id": "uuid", "quantity": 5, "unit_price": 99.99 }
 *   ]
 * }
 *
 * Response: { order_id, status, items, total_amount, correlation_id }
 */
export async function checkout(c: Context): Promise<any> {
  const correlationId = c.get('correlationId') as string;
  const childLogger = logger.withContext({
    correlationId,
    handler: 'checkout',
  });

  try {
    // =========================================================================
    // 1. VALIDAR SOLICITUD
    // =========================================================================
    const body = (await c.req.json()) as CheckoutRequest;

    if (!body.customer_id || !Array.isArray(body.items) || body.items.length === 0) {
      childLogger.warn('⚠️  Solicitud de checkout inválida', { body });
      return c.json(
        {
          success: false,
          error: 'customer_id y items[] son requeridos',
          correlation_id: correlationId,
        } as ApiResponse<null>,
        400
      );
    }

    // Validar items
    for (const item of body.items) {
      if (!item.product_id || item.quantity <= 0 || item.unit_price < 0) {
        return c.json(
          {
            success: false,
            error: 'Items inválidos: product_id, quantity positive, unit_price required',
            correlation_id: correlationId,
          } as ApiResponse<null>,
          400
        );
      }
    }

    // =========================================================================
    // 2. SIMULAR LATENCIA (si está configurada)
    // =========================================================================
    if (config.simulation.orderSlowMs > 0) {
      childLogger.info(`⏳ Simulando latencia de ${config.simulation.orderSlowMs}ms`);
      await new Promise(resolve => setTimeout(resolve, config.simulation.orderSlowMs));
    }

    // =========================================================================
    // 3. CALCULAR TOTAL
    // =========================================================================
    const total_amount = body.items.reduce(
      (sum, item) => sum + item.quantity * item.unit_price,
      0
    );

    // =========================================================================
    // 4. CREAR ORDEN EN BD (transacción)
    // =========================================================================
    const orderId = uuidv4();
    const now = new Date();

    childLogger.info('📝 Creando orden...', {
      orderId,
      customerId: body.customer_id,
      itemCount: body.items.length,
      totalAmount: total_amount,
    });

    try {
      const client = await db.beginTransaction(correlationId);

      try {
        // Insertar orden
        await client.query(
          `INSERT INTO orders (id, customer_id, status, total_amount, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderId, body.customer_id, 'PENDING', total_amount, now, now]
        );

        // Insertar items
        for (const item of body.items) {
          await client.query(
            `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
             VALUES ($1, $2, $3, $4, $5)`,
            [uuidv4(), orderId, item.product_id, item.quantity, item.unit_price]
          );
        }

        // Guardar evento en auditoria
        const eventPayload = {
          customer_id: body.customer_id,
          items: body.items,
          total_amount,
        };
        await client.query(
          `INSERT INTO order_events (id, order_id, event_type, correlation_id, payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv4(), orderId, 'ORDER_CREATED', correlationId, JSON.stringify(eventPayload)]
        );

        await db.commit(client, correlationId);
        childLogger.info('✅ Orden guardada en BD', { orderId });
      } catch (txError) {
        await db.rollback(client, correlationId);
        throw txError;
      }
    } catch (dbError) {
      childLogger.error('❌ Error guardando orden', dbError);
      return c.json(
        {
          success: false,
          error: 'Error creando orden en base de datos',
          correlation_id: correlationId,
        } as ApiResponse<null>,
        500
      );
    }

    // =========================================================================
    // 5. PUBLICAR EVENTO KAFKA
    // =========================================================================
    const orderCreatedEvent: OrderCreatedEvent = {
      event_id: uuidv4(),
      event_type: 'ORDER_CREATED',
      timestamp: now.toISOString(),
      correlation_id: correlationId,
      order_id: orderId,
      customer_id: body.customer_id,
      items: body.items,
      total_amount,
    };

    try {
      await kafkaProducer.publishOrderCreated(orderCreatedEvent, correlationId);
      childLogger.info('✅ Evento order.created publicado', { orderId });
    } catch (kafkaError) {
      childLogger.error('❌ Error publicando evento Kafka', kafkaError);
      // En producción, podrías reintentar o guardar para retry posterior
      // Por ahora, registrar pero no fallar la solicitud
    }

    // =========================================================================
    // 6. RESPONDER AL CLIENTE
    // =========================================================================
    const response: ApiResponse<Order> = {
      success: true,
      data: {
        id: orderId,
        customer_id: body.customer_id,
        status: 'PENDING',
        items: body.items,
        total_amount,
        created_at: now,
        updated_at: now,
        inventory_response_received_at: null,
      },
      correlation_id: correlationId,
    };

    childLogger.info('✅ Respuesta de checkout enviada', {
      orderId,
      status: 'PENDING',
    });

    return c.json(response, 202); // 202 Accepted (procesando asincronamente)
  } catch (error) {
    childLogger.error('❌ Error en checkout', error);
    return c.json(
      {
        success: false,
        error: 'Error interno del servidor',
        correlation_id: correlationId,
      } as ApiResponse<null>,
      500
    );
  }
}
