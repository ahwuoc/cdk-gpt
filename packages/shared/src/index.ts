export const InventoryStatus = {
  AVAILABLE: 'AVAILABLE', RESERVED: 'RESERVED', SOLD: 'SOLD',
  DISABLED: 'DISABLED', RETURNED: 'RETURNED',
} as const;
export type InventoryStatusValue = typeof InventoryStatus[keyof typeof InventoryStatus];

export const ProductStatus = { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', ARCHIVED: 'ARCHIVED' } as const;
export const UserStatus = { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', BLOCKED: 'BLOCKED' } as const;
export const OrderStatus = {
  PENDING_DELIVERY: 'PENDING_DELIVERY', DELIVERING: 'DELIVERING', DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED', REFUNDED: 'REFUNDED', CANCELLED: 'CANCELLED',
} as const;
export const DeliveryStatus = { PENDING: 'PENDING', PROCESSING: 'PROCESSING', DELIVERED: 'DELIVERED', FAILED: 'FAILED' } as const;
export const WalletTransactionType = {
  DEPOSIT: 'DEPOSIT', PURCHASE: 'PURCHASE', REFUND: 'REFUND', ADMIN_CREDIT: 'ADMIN_CREDIT',
  ADMIN_DEBIT: 'ADMIN_DEBIT', REFERRAL_COMMISSION: 'REFERRAL_COMMISSION', ADJUSTMENT: 'ADJUSTMENT',
} as const;
export const PaymentRequestStatus = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', EXPIRED: 'EXPIRED' } as const;

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'DomainError';
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor() { super('INSUFFICIENT_BALANCE', 'Insufficient wallet balance', 409); }
}
export class OutOfStockError extends DomainError {
  constructor() { super('OUT_OF_STOCK', 'No inventory item is available', 409); }
}
export class IdempotencyConflictError extends DomainError {
  constructor() { super('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another operation', 409); }
}

export function isMongoDuplicateKey(error: unknown): error is { code: number; keyPattern?: Record<string, number> } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === 11000;
}
