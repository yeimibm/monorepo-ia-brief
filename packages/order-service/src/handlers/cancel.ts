/**
 * Handler: POST /orders/:id/cancel
 * Cancelar una orden
 */

import { Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/client.js';
import { kafkaProducer } from '../kafka/producer.js';
import { logger } from '../logger.js';
import { CancelRequest, Order, OrderCancelledEvent, ApiResponse } from '../types/index.js';

/**
 * POST /orders/:id/cancel
 * Cancelar orden existente
 *
 * Request body:
 * { "reason": "user_request" }
 *
 * Response: { data: order, status: CANCELLED, correlation_id }
 */
export async function cancelOrder(c: Context): Promise<any> {
  const orderId = c.req.param('id');
  const correlationId = c.get('correlationId') as string;
  const childLogger = logger.withContext({
    correlationId,
    handler: 'cancelOrder',
    orderId,
  });

  try {
    // =========================================================================
    // 1. VALIDAR SOLICITUD
    // =========================================================================
    let body: CancelRequest = { reason: 'unknown' };
    try {
      body = (await c.req.json()) as CancelRequest;
    } catch {
      // Body es opcional
    }

    if (!body.reason) {
      body.reason = 'user_request';
    }

    // =========================================================================
    // 2. OBTENER ORDEN Y VALIDAR ESTADO
    // =========================================================================
    childLogger.info('🔍 Buscando orden...', { orderId });

    const orderResult = await db.query<Order>(
      `SELECT id, customer_id, status, total_amount, created_at, updated_at, inventory_response_received_at
       FROM orders WHERE id = $1`,
      [orderId],
      correlationId
    );

    if (orderResult.rows.length === 0) {
      childLogger.warn('⚠️  Orden no encontrada', { orderId });
      return c.json(
        {
          success: false,
          error: 'Orden no encontrada',
          correlation_id: correlationId,
        } as ApiResponse<null>,
        404
      );
    }

    const order = orderResult.rows[0];

    // Validar que se puede cancelar
    if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
      childLogger.warn('⚠️  Orden no puede cancelarse en este estado', {
        orderId,
        currentStatus: order.status,
      });
      return c.json(
        {
          success: false,
          error: `No se puede cancelar orden con estado ${order.status}`,
          correlation_id: correlationId,
        } as ApiResponse<null>,
        409 // Conflict
      );
    }

    // =========================================================================
    // 3. ACTUALIZAR ORDEN A CANCELLED (transacción)
    // =========================================================================
    childLogger.info('📝 Cancelando orden...', {
      orderId,
      currentStatus: order.status,
      reason: body.reason,
    });

    try {
      const client = await db.beginTransaction(correlationId);

      try {
        // Actualizar estado
        const now = new Date();
        await client.query(
          `UPDATE orders 
           SET status = 'CANCELLED', updated_at = $2
           WHERE id = $1`,
          [orderId, now]
        );

        // Guardar evento de cancelación
        await client.query(
          `INSERT INTO order_events (id, order_id, event_type, correlation_id, payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            uuidv4(),
            orderId,
            'ORDER_CANCELLED',
            correlationId,
            JSON.stringify({ reason: body.reason }),
          ]
        );

        await db.commit(client, correlationId);
        childLogger.info('✅ Orden cancelada en BD', { orderId });
      } catch (txError) {
        await db.rollback(client, correlationId);
        throw txError;
      }
    } catch (dbError) {
      childLogger.error('❌ Error cancelando orden', dbError);
      return c.json(
        {
          success: false,
          error: 'Error cancelando orden',
          correlation_id: correlationId,
        } as ApiResponse<null>,
        500
      );
    }

    // =========================================================================
    // 4. PUBLICAR EVENTO KAFKA: order.cancelled
    // =========================================================================
    const orderCancelledEvent: OrderCancelledEvent = {
      event_id: uuidv4(),
      event_type: 'ORDER_CANCELLED',
      timestamp: new Date().toISOString(),
      correlation_id: correlationId,
      order_id: orderId,
      reason: body.reason,
    };

    try {
      await kafkaProducer.publishOrderCancelled(orderCancelledEvent, correlationId);
      childLogger.info('✅ Evento order.cancelled publicado', { orderId });
    } catch (kafkaError) {
      childLogger.error('❌ Error publicando evento Kafka', kafkaError);
      // Registrar pero no fallar
    }

    // =========================================================================
    // 5. RESPONDER AL CLIENTE
    // =========================================================================
    const response: ApiResponse<Order> = {
      success: true,
      data: {
        ...order,
        status: 'CANCELLED' as any,
        updated_at: new Date(),
      },
      correlation_id: correlationId,
    };

    childLogger.info('✅ Respuesta de cancelación enviada', {
      orderId,
      status: 'CANCELLED',
    });

    return c.json(response, 200);
  } catch (error) {
    childLogger.error('❌ Error en cancelOrder', error);
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

/**
 * GET /orders/:id
 * Obtener orden por ID
 */
export async function getOrder(c: Context): Promise<any> {
  const orderId = c.req.param('id');
  const correlationId = c.get('correlationId') as string;
  const childLogger = logger.withContext({
    correlationId,
    handler: 'getOrder',
    orderId,
  });

  try {
    // Obtener orden
    const orderResult = await db.query<Order>(
      `SELECT id, customer_id, status, total_amount, created_at, updated_at, inventory_response_received_at
       FROM orders WHERE id = $1`,
      [orderId],
      correlationId
    );

    if (orderResult.rows.length === 0) {
      childLogger.warn('⚠️  Orden no encontrada', { orderId });
      return c.json(
        {
          success: false,
          error: 'Orden no encontrada',
          correlation_id: correlationId,
        } as ApiResponse<null>,
        404
      );
    }

    const order = orderResult.rows[0];

    // Obtener items
    const itemsResult = await db.query(
      `SELECT product_id, quantity, unit_price FROM order_items WHERE order_id = $1`,
      [orderId],
      correlationId
    );

    order.items = itemsResult.rows;

    const response: ApiResponse<Order> = {
      success: true,
      data: order,
      correlation_id: correlationId,
    };

    return c.json(response, 200);
  } catch (error) {
    childLogger.error('❌ Error en getOrder', error);
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
