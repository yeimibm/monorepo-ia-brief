/**
 * Migraciones de base de datos (DDL)
 * Ejecutar con: npm run db:migrate
 * O automáticamente al iniciar la aplicación
 */

import { db } from './client.js';
import { logger } from '../logger.js';

/**
 * DDL para tabla de órdenes
 */
const CREATE_ORDERS_TABLE = `
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED')),
  total_amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inventory_response_received_at TIMESTAMP
);
`;

/**
 * DDL para items de orden
 */
const CREATE_ORDER_ITEMS_TABLE = `
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10, 2) NOT NULL,
  
  CONSTRAINT fk_order FOREIGN KEY (order_id) 
    REFERENCES orders(id) ON DELETE CASCADE
);
`;

/**
 * DDL para eventos de orden (auditoria)
 */
const CREATE_ORDER_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  correlation_id UUID NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_order FOREIGN KEY (order_id) 
    REFERENCES orders(id) ON DELETE CASCADE
);
`;

/**
 * DDL para idempotencia: eventos ya procesados
 */
const CREATE_PROCESSED_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS processed_events (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  order_id UUID NOT NULL,
  correlation_id UUID NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

/**
 * Índices para optimizar queries
 */
const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_event_type ON order_events(event_type);
CREATE INDEX IF NOT EXISTS idx_processed_events_order_id ON processed_events(order_id);
`;

/**
 * Ejecutar todas las migraciones
 */
export async function runMigrations(): Promise<void> {
  logger.info('Iniciando migraciones de base de datos...');

  try {
    // PostgreSQL no usa CREATE TABLE IF NOT EXISTS como MySQL
    // pero en PostgreSQL 9.1+ sí existe
    await db.query(CREATE_ORDERS_TABLE);
    logger.info('✅ Tabla orders creada/verificada');

    await db.query(CREATE_ORDER_ITEMS_TABLE);
    logger.info('✅ Tabla order_items creada/verificada');

    await db.query(CREATE_ORDER_EVENTS_TABLE);
    logger.info('✅ Tabla order_events creada/verificada');

    await db.query(CREATE_PROCESSED_EVENTS_TABLE);
    logger.info('✅ Tabla processed_events creada/verificada');

    // Crear índices (idempotentes en PostgreSQL)
    // Dividir por línea
    const indexes = CREATE_INDEXES.split(';').filter(idx => idx.trim());
    for (const index of indexes) {
      if (index.trim()) {
        await db.query(index);
      }
    }
    logger.info('✅ Índices creados/verificados');

    logger.info('✅ Migraciones completadas exitosamente');
  } catch (error) {
    logger.error('❌ Error ejecutando migraciones', error);
    throw error;
  }
}

/**
 * Ejecutar si se llama directamente
 */
// @ts-ignore
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('Migraciones completadas');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error en migraciones:', error);
      process.exit(1);
    });
}
