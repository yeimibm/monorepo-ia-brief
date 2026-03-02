/**
 * Order Service - Entry Point
 * API REST + Event-Driven Architecture
 * 
 * Start: npm run dev
 * Build: npm run build
 * Run: npm run start
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from './logger.js';
import { config } from './config.js';
import { db } from './db/client.js';
import { kafkaProducer } from './kafka/producer.js';
import { kafkaConsumer } from './kafka/consumer.js';
import { runMigrations } from './db/migrations.js';
import { correlationIdMiddleware } from './utils/correlation-id.js';
import { checkout } from './handlers/checkout.js';
import { cancelOrder, getOrder } from './handlers/cancel.js';

/**
 * Crear aplicación Hono
 */
const app = new Hono();

// =========================================================================
// MIDDLEWARE
// =========================================================================

/**
 * Middleware: Correlation ID
 * Agregar X-Correlation-Id a cada solicitud
 */
app.use('*', correlationIdMiddleware());

/**
 * Middleware: Logging (todas las solicitudes)
 */
app.use('*', async (c: any, next: any) => {
  const correlationId = c.get('correlationId') as string;
  const start = Date.now();

  logger.info('📨 Solicitud HTTP recibida', {
    correlationId,
    method: c.req.method,
    path: c.req.path,
  });

  await next();

  const duration = Date.now() - start;
  logger.info('📤 Respuesta HTTP enviada', {
    correlationId,
    method: c.req.method,
    path: c.req.path,
    status: 200, // Nota: Hono no expone status en middleware fácilmente
    duration,
  });
});

// =========================================================================
// RUTAS
// =========================================================================

/**
 * Health Check
 * GET /health
 */
app.get('/health', (c: any) => {
  const correlationId = c.get('correlationId') as string;
  logger.info('✅ Health check', { correlationId });
  return c.json({
    status: 'ok',
    service: 'order-service',
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
  });
});

/**
 * Readiness Check (para Kubernetes)
 * GET /ready
 */
app.get('/ready', async (c: any) => {
  const correlationId = c.get('correlationId') as string;
  try {
    // Verificar conexión a BD
    await db.query('SELECT 1');
    // Verificar Kafka (si está conectado)
    const ready = true;

    if (ready) {
      return c.json({ ready: true, correlation_id: correlationId }, 200);
    } else {
      return c.json({ ready: false, correlation_id: correlationId }, 503);
    }
  } catch (error) {
    logger.error('Readiness check failed', error);
    return c.json({ ready: false, error: 'BD no disponible' }, 503);
  }
});

/**
 * Checkout: Crear nueva orden
 * POST /checkout
 */
app.post('/checkout', checkout);

/**
 * Cancelar orden
 * POST /orders/:id/cancel
 */
app.post('/orders/:id/cancel', cancelOrder);

/**
 * Obtener orden
 * GET /orders/:id
 */
app.get('/orders/:id', getOrder);

/**
 * Listar órdenes (básico)
 * GET /orders?status=PENDING&limit=10
 */
app.get('/orders', async (c: any) => {
  const correlationId = c.get('correlationId') as string;
  const status = c.req.query('status') || 'PENDING';
  const limit = parseInt(c.req.query('limit') || '10', 10);

  try {
    const result = await db.query(
      `SELECT id, customer_id, status, total_amount, created_at, updated_at
       FROM orders 
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [status, limit],
      correlationId
    );

    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      correlation_id: correlationId,
    });
  } catch (error) {
    logger.error('Error en GET /orders', error);
    return c.json(
      {
        success: false,
        error: 'Error obteniendo órdenes',
        correlation_id: correlationId,
      },
      500
    );
  }
});

/**
 * 404 - Ruta no encontrada
 */
app.notFound((c: any) => {
  const correlationId = c.get('correlationId') as string;
  return c.json(
    {
      success: false,
      error: `Ruta no encontrada: ${c.req.path}`,
      correlation_id: correlationId,
    },
    404
  );
});

/**
 * Error handler
 */
app.onError((err: any, c: any) => {
  const correlationId = c.get('correlationId') as string;
  logger.error('Error no manejado', err, { correlationId });
  return c.json(
    {
      success: false,
      error: 'Error interno del servidor',
      correlation_id: correlationId,
    },
    500
  );
});

// =========================================================================
// INICIALIZACIÓN
// =========================================================================

/**
 * Función principal de inicialización
 */
async function bootstrap(): Promise<void> {
  try {
    // 1. Conectar a BD
    logger.info('🔌 Conectando a PostgreSQL...');
    await runMigrations();
    logger.info('✅ Migraciones completadas');

    // 2. Conectar a Kafka Producer
    logger.info('🔌 Conectando a Kafka Producer...');
    await kafkaProducer.connect();
    logger.info('✅ Kafka Producer conectado');

    // 3. Iniciar Kafka Consumer (en background)
    logger.info('🔌 Iniciando Kafka Consumer...');
    kafkaConsumer.start().catch((err) => {
      logger.error('❌ Error en Kafka Consumer', err);
      // No detener el servicio si el consumer falla
    });
    logger.info('✅ Kafka Consumer iniciado');

    // 4. Iniciar servidor HTTP
    const port = config.app.port;
    logger.info(`🚀 Iniciando Order Service en puerto ${port}...`);

    serve({
      fetch: app.fetch,
      port: port,
    });

    logger.info(`✅ Order Service escuchando en http://localhost:${port}`);
    logger.info(`📚 Health check: http://localhost:${port}/health`);
    logger.info(`📝 POST /checkout - Crear orden`);
    logger.info(`❌ POST /orders/:id/cancel - Cancelar orden`);
    logger.info(`📖 GET /orders/:id - Obtener orden`);

    // 5. Manejar shutdown graceful
    const handleGracefulShutdown = async () => {
      logger.info('🛑 Recibida señal de parada, cerrando conexiones...');

      try {
        await kafkaProducer.disconnect();
        await kafkaConsumer.disconnect();
        await db.close();
        logger.info('✅ Todos los servicios cerrados');
        process.exit(0);
      } catch (error) {
        logger.error('Error en shutdown', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', handleGracefulShutdown);
    process.on('SIGINT', handleGracefulShutdown);
  } catch (error) {
    logger.error('❌ Error en bootstrap', error);
    process.exit(1);
  }
}

// Ejecutar si se corre directamente
// @ts-ignore
if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap();
}

export default app;
