/**
 * Middleware HTTP Logging con Pino
 * 
 * Loggea:
 * - Método HTTP, URL, status code
 * - Latencia (tiempo de respuesta)
 * - Tamaño de response
 * - Errores con stack trace
 * 
 * NO loggea (datos sensibles):
 * - Body de la request (contiene datos de cliente)
 * - Headers de autenticación
 * - Tokens, passwords
 */

import { Context } from 'hono';
import { logger as baseLogger } from '../logger';

interface HttpLogContext {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  bytes_sent: number;
  correlation_id?: string;
  error?: string;
}

/**
 * Middleware para loggear requests/responses
 * 
 * Uso:
 * app.use(httpLogger())
 */
export function httpLogger() {
  return async (c: Context, next: () => Promise<void>) => {
    const startTime = Date.now();
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;
    
    // Extraer correlation ID de headers (o generar uno)
    const correlationId = c.req.header('x-correlation-id') || 
                         `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Almacenar en contexto para logs posteriores
    c.set('correlationId', correlationId);
    
    // Skip healthcheck logs (muy ruido)
    const isHealthCheck = path === '/health' || path === '/ready';
    
    try {
      // Ejecutar handler
      await next();
      
      // Calcular métricas
      const duration_ms = Date.now() - startTime;
      const status = c.res.status;
      const bytes_sent = c.res.headers.get('content-length') || '0';
      
      if (!isHealthCheck) {
        baseLogger.info(`${method} ${path}`, {
          method,
          path,
          status,
          duration_ms,
          bytes_sent,
          correlation_id: correlationId,
        });
      }
    } catch (error) {
      // Loggear errores
      const duration_ms = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      
      baseLogger.error(
        `${method} ${path} - ERROR`,
        {
          method,
          path,
          status: 500,
          duration_ms,
          correlation_id: correlationId,
          error: errorMsg,
          stack: errorStack,
        }
      );
      
      throw error;
    }
  };
}

/**
 * Middleware para loggear eventos Kafka publicados
 * 
 * Loggea:
 * - Tipo de evento
 * - Orden/IDs involucrados
 * - Correlation ID propagado
 */
export interface KafkaLogData {
  order_id?: string;
  product_id?: string;
  quantity?: number;
  correlation_id?: string;
  partition?: number;
  offset?: number;
}

export function createKafkaEventLogger() {
  return (eventType: string) => (data: KafkaLogData) => {
    baseLogger.info(
      `Event published: ${eventType}`,
      {
        event_type: eventType,
        ...data,
      }
    );
  };
}

/**
 * Middleware para loggear errores de procesos async
 * (Ideal para handlers de Kafka)
 */
export function createErrorHandler(context: string) {
  return (error: Error, data?: any) => {
    baseLogger.error(
      {
        context,
        error: error.message,
        stack: error.stack,
        ...data,
      },
      `[${context}] ERROR`
    );
  };
}

/**
 * Ejemplo de uso en un handler:
 * 
 * export const handleCheckout = async (c: Context) => {
 *   const logger = baseLogger.withContext({ 
 *     correlationId: c.get('correlationId')
 *   });
 *   
 *   try {
 *     const body = await c.req.json();
 *     
 *     // Validación
 *     if (!body.product_id) {
 *       logger.warn('Validation error', { errors: ['product_id required'] });
 *       return c.json({ error: 'Invalid request' }, 400);
 *     }
 *     
 *     // Crear orden
 *     const order = await createOrder(body);
 *     
 *     // Log exito
 *     logger.info('Order created', { 
 *       order_id: order.id,
 *       status: order.status
 *     });
 *     
 *     return c.json({ order_id: order.id, status: order.status });
 *     
 *   } catch (error) {
 *     // Log error con stack trace
 *     logger.error('Checkout failed', error as Error, {
 *       endpoint: '/checkout',
 *       attempt: 'first'
 *     });
 *     
 *     return c.json({ error: 'Internal server error' }, 500);
 *   }
 * }
 */
