/**
 * Tipos compartidos para Order Service
 */

export interface OrderItem {
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface Order {
  id: string;
  customer_id: string;
  status: OrderStatus;
  items: OrderItem[];
  total_amount: number;
  created_at: Date;
  updated_at: Date;
  inventory_response_received_at: Date | null;
}

export type OrderStatus = 
  | 'PENDING' 
  | 'CONFIRMED' 
  | 'REJECTED' 
  | 'CANCELLED' 
  | 'COMPLETED';

/**
 * EVENTOS KAFKA
 */

export interface OrderCreatedEvent {
  event_id: string;
  event_type: 'ORDER_CREATED';
  timestamp: string;
  correlation_id: string;
  order_id: string;
  customer_id: string;
  items: OrderItem[];
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
  details: {
    product_id: string;
    requested_quantity: number;
    available_quantity: number;
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
 * Solicitudes HTTP
 */

export interface CheckoutRequest {
  customer_id: string;
  items: OrderItem[];
}

export interface CancelRequest {
  reason: string;
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
