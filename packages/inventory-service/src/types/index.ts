/**
 * Tipos para Inventory Service
 */

export interface InventoryProduct {
  id: string;
  product_id: string;
  available: number;
  reserved: number;
  updated_at: Date;
}

export interface ReservedItem {
  id: string;
  reservation_id: string;
  product_id: string;
  quantity: number;
  status: 'RESERVED' | 'CONFIRMED' | 'RELEASED';
  reserved_at: Date;
  expired_at: Date | null;
}

/**
 * EVENTOS KAFKA (consumidos y publicados)
 */

export interface OrderCreatedEvent {
  event_id: string;
  event_type: 'ORDER_CREATED';
  timestamp: string;
  correlation_id: string;
  order_id: string;
  customer_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
  }>;
  total_amount: number;
}

export interface OrderCancelledEvent {
  event_id: string;
  event_type: 'ORDER_CANCELLED';
  timestamp: string;
  correlation_id: string;
  order_id: string;
  reason: string;
}

export interface InventoryReservedEvent {
  event_id: string;
  event_type: 'INVENTORY_RESERVED';
  timestamp: string;
  correlation_id: string;
  order_id: string;
  reservation_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    reserved_quantity: number;
    expiration_time: string;
  }>;
  status: 'RESERVED';
}

export interface InventoryRejectedEvent {
  event_id: string;
  event_type: 'INVENTORY_REJECTED';
  timestamp: string;
  correlation_id: string;
  order_id: string;
  reason: string;
  details: 
    | {
        product_id: string;
        requested_quantity: number;
        available_quantity: number;
        message: string;
      }
    | {
        message: string;
      };
  status: 'REJECTED';
}

export interface InventoryReleasedEvent {
  event_id: string;
  event_type: 'INVENTORY_RELEASED';
  timestamp: string;
  correlation_id: string;
  order_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
  }>;
}

/**
 * Respuesta de API
 */

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  correlation_id: string;
}
