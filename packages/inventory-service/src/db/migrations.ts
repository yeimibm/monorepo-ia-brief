/**
 * Migraciones DDL para Inventory Service
 */

import { db } from './client.js';
import { logger } from '../logger.js';

const CREATE_INVENTORY_TABLE = `
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY,
  product_id UUID NOT NULL UNIQUE,
  available INT NOT NULL CHECK (available >= 0),
  reserved INT NOT NULL CHECK (reserved >= 0) DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const CREATE_RESERVED_ITEMS_TABLE = `
CREATE TABLE IF NOT EXISTS reserved_items (
  id UUID PRIMARY KEY,
  reservation_id UUID NOT NULL UNIQUE,
  product_id UUID NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  status VARCHAR(50) NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED', 'CONFIRMED', 'RELEASED')),
  reserved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expired_at TIMESTAMP,
  
  CONSTRAINT fk_inventory FOREIGN KEY (product_id) 
    REFERENCES inventory(id)
);
`;

const CREATE_INVENTORY_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS inventory_events (
  id UUID PRIMARY KEY,
  product_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  order_id UUID NOT NULL,
  correlation_id UUID NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_inventory FOREIGN KEY (product_id) 
    REFERENCES inventory(id)
);
`;

const CREATE_PROCESSED_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS processed_events (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  order_id UUID NOT NULL,
  correlation_id UUID NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_reserved_items_status ON reserved_items(status);
CREATE INDEX IF NOT EXISTS idx_reserved_items_expired_at ON reserved_items(expired_at);
CREATE INDEX IF NOT EXISTS idx_inventory_events_order_id ON inventory_events(order_id);
CREATE INDEX IF NOT EXISTS idx_processed_events_order_id ON processed_events(order_id);
`;

export async function runMigrations(): Promise<void> {
  logger.info('Iniciando migraciones de base de datos...');

  try {
    await db.query(CREATE_INVENTORY_TABLE);
    logger.info('✅ Tabla inventory creada/verificada');

    await db.query(CREATE_RESERVED_ITEMS_TABLE);
    logger.info('✅ Tabla reserved_items creada/verificada');

    await db.query(CREATE_INVENTORY_EVENTS_TABLE);
    logger.info('✅ Tabla inventory_events creada/verificada');

    await db.query(CREATE_PROCESSED_EVENTS_TABLE);
    logger.info('✅ Tabla processed_events creada/verificada');

    const indexes = CREATE_INDEXES.split(';').filter(idx => idx.trim());
    for (const index of indexes) {
      if (index.trim()) {
        await db.query(index);
      }
    }
    logger.info('✅ Índices creados/verificados');

    logger.info('✅ Migraciones completadas');
  } catch (error) {
    logger.error('❌ Error en migraciones', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('Migraciones completadas');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}
