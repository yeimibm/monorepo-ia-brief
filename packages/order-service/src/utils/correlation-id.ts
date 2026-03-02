/**
 * Utilidades para Correlation ID
 * Permite rastrear una solicitud a través de múltiples servicios
 */

import { v4 as uuidv4 } from 'uuid';
import { Context } from 'hono';

/**
 * Extraer o generar Correlation ID desde headers
 * Prioridad:
 * 1. Header X-Correlation-Id (si viene del cliente)
 * 2. Header x-correlation-id (variante minúscula)
 * 3. Generar UUID nuevo si no viene ninguno
 */
export function getOrGenerateCorrelationId(c: Context): string {
  const fromHeader = 
    c.req.header('X-Correlation-Id') || 
    c.req.header('x-correlation-id');

  if (fromHeader) {
    return fromHeader;
  }

  return uuidv4();
}

/**
 * Generar nuevo event ID (único para cada evento)
 */
export function generateEventId(): string {
  return uuidv4();
}

/**
 * Middleware para Hono que agrega correlation ID al contexto
 */
export function correlationIdMiddleware() {
  return async (c: Context, next: any) => {
    const correlationId = getOrGenerateCorrelationId(c);
    
    // Guardar en contexto para acceso en handlers
    c.set('correlationId', correlationId);
    
    // Agregar al response header
    c.header('X-Correlation-Id', correlationId);

    await next();
  };
}
