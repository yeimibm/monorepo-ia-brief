/**
 * Utilidades de Correlation ID
 */

import { v4 as uuidv4 } from 'uuid';

export function getOrGenerateCorrelationId(c: any): string {
  const fromHeader = c.req.header('X-Correlation-Id') || c.req.header('x-correlation-id');
  return fromHeader || uuidv4();
}

export function generateEventId(): string {
  return uuidv4();
}

export function correlationIdMiddleware() {
  return async (c: any, next: any) => {
    const correlationId = getOrGenerateCorrelationId(c);
    c.set('correlationId', correlationId);
    c.header('X-Correlation-Id', correlationId);
    await next();
  };
}
