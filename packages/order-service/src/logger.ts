/**
 * Logger para Order Service (Pino)
 * - DEV: pino-pretty (bonito para consola)
 * - PROD: JSON (ideal para contenedores / observabilidad)
 */

import pino, { Logger as PinoLogger, TransportSingleOptions } from 'pino';

export interface LoggerContext {
  correlationId?: string;
  eventType?: string;
  orderId?: string;
  productId?: string;
  [key: string]: any;
}

const level = process.env.LOG_LEVEL || 'info';
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// Solo en desarrollo usamos pino-pretty
const transport: TransportSingleOptions | undefined = !isProd
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

const baseLogger: PinoLogger = pino({
  level,
  ...(transport ? { transport } : {}),
  base: {
    service: 'order-service',
    environment: nodeEnv,
  },
});

export class Logger {
  constructor(private logger: PinoLogger, private context: LoggerContext = {}) {}

  withContext(newContext: LoggerContext): Logger {
    return new Logger(this.logger, { ...this.context, ...newContext });
  }

  info(message: string, data?: any) {
    this.logger.info({ ...this.context, ...data }, message);
  }

  error(message: string, error?: Error | any, data?: any) {
    this.logger.error(
      {
        ...this.context,
        ...data,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      },
      message
    );
  }

  warn(message: string, data?: any) {
    this.logger.warn({ ...this.context, ...data }, message);
  }

  debug(message: string, data?: any) {
    this.logger.debug({ ...this.context, ...data }, message);
  }
}

export const logger = new Logger(baseLogger);