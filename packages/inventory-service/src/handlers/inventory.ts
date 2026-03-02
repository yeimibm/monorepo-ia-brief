/**
 * Handlers para Inventory Service
 */

import { Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/client.js';
import { logger } from '../logger.js';
import { InventoryProduct, ApiResponse } from '../types/index.js';

/**
 * GET /inventory
 * Listar todo el inventario
 */
export async function listInventory(c: Context): Promise<Response> {
  const correlationId = c.get('correlationId') as string;

  try {
    const result = await db.query<InventoryProduct>(
      `SELECT id, product_id, available, reserved, updated_at 
       FROM inventory 
       ORDER BY product_id ASC`,
      [],
      correlationId
    );

    const response: ApiResponse<InventoryProduct[]> = {
      success: true,
      data: result.rows,
      correlation_id: correlationId,
    };

    return c.json(response);
  } catch (error) {
    logger.error('Error en listInventory', error);
    return c.json(
      {
        success: false,
        error: 'Error obteniendo inventario',
        correlation_id: correlationId,
      } as ApiResponse<null>,
      500
    );
  }
}

/**
 * GET /inventory/:product_id
 * Obtener inventario de un producto
 */
export async function getInventoryByProduct(c: Context): Promise<Response> {
  const productId = c.req.param('product_id');
  const correlationId = c.get('correlationId') as string;

  try {
    const result = await db.query<InventoryProduct>(
      `SELECT id, product_id, available, reserved, updated_at 
       FROM inventory 
       WHERE product_id = $1`,
      [productId],
      correlationId
    );

    if (result.rows.length === 0) {
      return c.json(
        {
          success: false,
          error: 'Producto no encontrado en inventario',
          correlation_id: correlationId,
        } as ApiResponse<null>,
        404
      );
    }

    const response: ApiResponse<InventoryProduct> = {
      success: true,
      data: result.rows[0],
      correlation_id: correlationId,
    };

    return c.json(response);
  } catch (error) {
    logger.error('Error en getInventoryByProduct', error);
    return c.json(
      {
        success: false,
        error: 'Error obteniendo inventario del producto',
        correlation_id: correlationId,
      } as ApiResponse<null>,
      500
    );
  }
}

/**
 * POST /inventory
 * Crear o actualizar inventario (admin endpoint)
 */
export async function createOrUpdateInventory(c: Context): Promise<Response> {
  const correlationId = c.get('correlationId') as string;
  const childLogger = logger.withContext({ correlationId });

  try {
    const body = (await c.req.json()) as {
      product_id: string;
      available: number;
    };

    if (!body.product_id || body.available === undefined) {
      return c.json(
        {
          success: false,
          error: 'product_id y available son requeridos',
          correlation_id: correlationId,
        } as ApiResponse<null>,
        400
      );
    }

    if (body.available < 0) {
      return c.json(
        {
          success: false,
          error: 'available no puede ser negativo',
          correlation_id: correlationId,
        } as ApiResponse<null>,
        400
      );
    }

    // Verificar si el producto ya existe
    const existingResult = await db.query(
      `SELECT id FROM inventory WHERE product_id = $1`,
      [body.product_id],
      correlationId
    );

    let inventoryId: string;
    let isNew = false;

    if (existingResult.rows.length > 0) {
      // Actualizar
      inventoryId = existingResult.rows[0].id;
      await db.query(
        `UPDATE inventory SET available = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2`,
        [body.available, body.product_id],
        correlationId
      );

      childLogger.info('✅ Inventario actualizado', {
        productId: body.product_id,
        available: body.available,
      });
    } else {
      // Crear
      inventoryId = uuidv4();
      await db.query(
        `INSERT INTO inventory (id, product_id, available, reserved)
         VALUES ($1, $2, $3, 0)`,
        [inventoryId, body.product_id, body.available],
        correlationId
      );

      isNew = true;

      childLogger.info('✅ Inventario creado', {
        productId: body.product_id,
        available: body.available,
      });
    }

    const response: ApiResponse<InventoryProduct> = {
      success: true,
      data: {
        id: inventoryId,
        product_id: body.product_id,
        available: body.available,
        reserved: 0,
        updated_at: new Date(),
      },
      correlation_id: correlationId,
    };

    return c.json(response, isNew ? 201 : 200);
  } catch (error) {
    childLogger.error('Error en createOrUpdateInventory', error);
    return c.json(
      {
        success: false,
        error: 'Error creando/actualizando inventario',
        correlation_id: correlationId,
      } as ApiResponse<null>,
      500
    );
  }
}
