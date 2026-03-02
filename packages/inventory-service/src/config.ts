/**
 * Configuración del Inventory Service
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

export const config = {
  app: {
    port: parseInt(process.env.INVENTORY_SERVICE_PORT || '3002', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
  },

  database: {
    host: process.env.INVENTORY_DB_HOST || 'inventory-db',
    port: parseInt(process.env.INVENTORY_DB_PORT || '5432', 10),
    user: process.env.INVENTORY_DB_USER || 'inventory_user',
    password: process.env.INVENTORY_DB_PASSWORD || 'inventory_password',
    database: process.env.INVENTORY_DB_NAME || 'inventory_db',
    connectionString: process.env.DATABASE_URL,
    max: 20,
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'kafka:29092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'inventory-service',
    topics: {
      orderCreated: process.env.KAFKA_TOPIC_ORDER_CREATED || 'order.created',
      orderCancelled: process.env.KAFKA_TOPIC_ORDER_CANCELLED || 'order.cancelled',
      inventoryReserved: process.env.KAFKA_TOPIC_INVENTORY_RESERVED || 'inventory.reserved',
      inventoryRejected: process.env.KAFKA_TOPIC_INVENTORY_REJECTED || 'inventory.rejected',
      inventoryReleased: process.env.KAFKA_TOPIC_INVENTORY_RELEASED || 'inventory.released',
    },
    consumerGroups: {
      inventoryService: process.env.KAFKA_CONSUMER_GROUP_INVENTORY || 'inventory-service-group',
    },
  },

  simulation: {
    // Modo de falla: 'none' | 'reject' | 'crash' | 'timeout'
    failReserveMode: (process.env.FAIL_RESERVE_MODE || 'none') as
      | 'none'
      | 'reject'
      | 'crash'
      | 'timeout',
    // Porcentaje de órdenes que fallarán (0-100)
    failReservePercent: parseInt(process.env.FAIL_RESERVE_PERCENT || '0', 10),
  },

  validate: () => {
    const required = ['INVENTORY_DB_USER', 'INVENTORY_DB_PASSWORD', 'KAFKA_BROKERS'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Variables de entorno faltantes: ${missing.join(', ')}`);
    }
  },
};

config.validate();
