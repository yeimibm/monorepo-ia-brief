import { Pool, QueryResult, PoolClient } from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

class DatabaseClient {
  private pool: Pool;

  constructor() {
    const cs = config.database.connectionString;

    const poolConfig =
      typeof cs === 'string' && cs.length > 0
        ? { connectionString: cs, max: config.database.max }
        : {
            host: config.database.host,
            port: config.database.port,
            user: config.database.user,
            password: config.database.password,
            database: config.database.database,
            max: config.database.max,
          };

    this.pool = new Pool(poolConfig);

    this.pool.on('error', (err: any) => {
      logger.error('Error no tratado en pool de PostgreSQL', err);
    });
  }

  async query<T = any>(
    text: string,
    values?: any[],
    correlationId?: string
  ): Promise<QueryResult<any>> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, values);
      const duration = Date.now() - start;

      logger.debug('DB Query ejecutado', {
        correlationId,
        duration,
        command: text.split('\n')[0],
        rows: result.rowCount,
      });

      return result;
    } catch (error) {
      logger.error('DB Query error', error, {
        correlationId,
        command: text.split('\n')[0],
      });
      throw error;
    }
  }

  async beginTransaction(correlationId?: string): Promise<PoolClient> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      logger.debug('Transacción iniciada', { correlationId });
      return client;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async commit(client: PoolClient, correlationId?: string): Promise<void> {
    try {
      await client.query('COMMIT');
      logger.debug('Transacción commitida', { correlationId });
    } finally {
      client.release();
    }
  }

  async rollback(client: PoolClient, correlationId?: string): Promise<void> {
    try {
      await client.query('ROLLBACK');
      logger.debug('Transacción revertida', { correlationId });
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Pool de PostgreSQL cerrado');
  }
}

export const db = new DatabaseClient();