/**
 * Inventory Service - Entry Point
 * Event-driven consumer de order.created y order.cancelled
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';
import { config } from './config.js';
import { db } from './db/client.js';
import { kafkaProducer } from './kafka/producer.js';
import { kafkaConsumer } from './kafka/consumer.js';
import { runMigrations } from './db/migrations.js';
import { correlationIdMiddleware } from './utils/correlation-id.js';
import {
  listInventory,
  getInventoryByProduct,
  createOrUpdateInventory,
} from './handlers/inventory.js';

// Importar correlationIdMiddleware (copiar del order-service)
function correlationIdMiddleware2() {
  return async (c: any, next: any) => {
    const fromHeader = c.req.header('X-Correlation-Id') || c.req.header('x-correlation-id');
    const correlationId = fromHeader || uuidv4();

    c.set('correlationId', correlationId);
    c.header('X-Correlation-Id', correlationId);

    await next();
  };
}

const app = new Hono();

// =========================================================================
// MIDDLEWARE
// =========================================================================

app.use('*', correlationIdMiddleware2());

app.use('*', async (c: any, next: any) => {
  const correlationId = c.get('correlationId') as string;
  logger.info('📨 Solicitud HTTP recibida', {
    correlationId,
    method: c.req.method,
    path: c.req.path,
  });

  await next();

  logger.info('📤 Respuesta HTTP enviada', {
    correlationId,
    method: c.req.method,
    path: c.req.path,
  });
});

// =========================================================================
// RUTAS
// =========================================================================

/**
 * Health Check
 */
app.get('/health', (c: any) => {
  const correlationId = c.get('correlationId') as string;
  return c.json({
    status: 'ok',
    service: 'inventory-service',
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
  });
});

/**
 * Readiness Check
 */
app.get('/ready', async (c: any) => {
  const correlationId = c.get('correlationId') as string;
  try {
    await db.query('SELECT 1');
    return c.json({ ready: true, correlation_id: correlationId }, 200);
  } catch (error) {
    logger.error('Readiness check failed', error);
    return c.json({ ready: false, error: 'BD no disponible' }, 503);
  }
});

/**
 * Listar todo el inventario
 * GET /inventory
 */
app.get('/inventory', listInventory);

/**
 * Obtener inventario de un producto
 * GET /inventory/:product_id
 */
app.get('/inventory/:product_id', getInventoryByProduct);

/**
 * Crear/Actualizar inventario (admin)
 * POST /inventory
 */
app.post('/inventory', createOrUpdateInventory);

/**
 * 404
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

    // 3. Iniciar Kafka Consumer (background)
    logger.info('🔌 Iniciando Kafka Consumer...');
    kafkaConsumer.start().catch((err) => {
      logger.error('❌ Error en Kafka Consumer', err);
    });
    logger.info('✅ Kafka Consumer iniciado');

    // 4. Iniciar servidor HTTP
    const port = config.app.port;
    logger.info(`🚀 Iniciando Inventory Service en puerto ${port}...`);

    serve({
      fetch: app.fetch,
      port: port,
    });

    logger.info(`✅ Inventory Service escuchando en http://localhost:${port}`);
    logger.info(`📚 Health check: http://localhost:${port}/health`);
    logger.info(`📦 GET /inventory - Listar inventario`);
    logger.info(`📦 GET /inventory/:product_id - Obtener producto`);
    logger.info(`📦 POST /inventory - Crear/Actualizar producto`);

    // 5. Graceful shutdown
    const handleGracefulShutdown = async () => {
      logger.info('🛑 Recibida señal de parada...');

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
