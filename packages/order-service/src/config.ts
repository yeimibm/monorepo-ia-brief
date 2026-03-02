/**
 * Configuración del Order Service
 * Cargada desde variables de entorno
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

export const config = {
  // =========================================================================
  // APLICACIÓN
  // =========================================================================
  app: {
    port: parseInt(process.env.ORDER_SERVICE_PORT || '3001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
  },

  // =========================================================================
  // POSTGRESQL
  // =========================================================================
  database: {
    host: process.env.ORDERS_DB_HOST || 'orders-db',
    port: parseInt(process.env.ORDERS_DB_PORT || '5432', 10),
    user: process.env.ORDERS_DB_USER || 'orders_user',
    password: process.env.ORDERS_DB_PASSWORD || 'orders_password',
    database: process.env.ORDERS_DB_NAME || 'orders_db',
    // Usar DATABASE_URL si está disponible
    connectionString: process.env.DATABASE_URL,
    max: 20, // Pool connections
  },

  // =========================================================================
  // KAFKA / REDPANDA
  // =========================================================================
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'kafka:29092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'order-service',
    topics: {
      orderCreated: process.env.KAFKA_TOPIC_ORDER_CREATED || 'order.created',
      orderCancelled: process.env.KAFKA_TOPIC_ORDER_CANCELLED || 'order.cancelled',
      inventoryReserved: process.env.KAFKA_TOPIC_INVENTORY_RESERVED || 'inventory.reserved',
      inventoryRejected: process.env.KAFKA_TOPIC_INVENTORY_REJECTED || 'inventory.rejected',
      inventoryReleased: process.env.KAFKA_TOPIC_INVENTORY_RELEASED || 'inventory.released',
    },
    consumerGroups: {
      orderService: process.env.KAFKA_CONSUMER_GROUP_ORDER || 'order-service-group',
    },
  },

  // =========================================================================
  // SIMULACIÓN DE FALLAS
  // =========================================================================
  simulation: {
    orderSlowMs: parseInt(process.env.ORDER_SLOW_MS || '0', 10),
  },

  // =========================================================================
  // VALIDACIÓN
  // =========================================================================
  validate: () => {
    const required = [
      'ORDERS_DB_USER',
      'ORDERS_DB_PASSWORD',
      'KAFKA_BROKERS',
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Variables de entorno faltantes: ${missing.join(', ')}`);
    }
  },
};

// Validar configuración al importar
config.validate();
