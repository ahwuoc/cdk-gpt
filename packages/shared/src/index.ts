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
export const MAX_TELEGRAM_QUICK_CHECKOUT_QUANTITY = 5;

/** Returns the rounded percentage off, or 0 when the product is not on sale. */
export function productDiscountPercent(price: number, originalPrice?: number | null) {
  if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(originalPrice) ||
    originalPrice === undefined || originalPrice === null || originalPrice <= price || originalPrice <= 0) return 0;
  return Math.max(1, Math.min(100, Math.round(((originalPrice - price) / originalPrice) * 100)));
}

/** Keeps the first pre-sale price across repeated reductions and clears it once the sale price reaches it. */
export function productOriginalPriceAfterChange(currentPrice: number, currentOriginalPrice: number | undefined,
  nextPrice: number) {
  const activeOriginal = currentOriginalPrice && currentOriginalPrice > currentPrice ? currentOriginalPrice : undefined;
  if (nextPrice < currentPrice) return Math.max(activeOriginal ?? 0, currentPrice);
  if (activeOriginal && nextPrice < activeOriginal) return activeOriginal;
  return undefined;
}
export const ComplaintCategory = {
  NO_DELIVERY: 'NO_DELIVERY',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PRODUCT_MISMATCH: 'PRODUCT_MISMATCH',
  WARRANTY: 'WARRANTY',
  OTHER: 'OTHER',
} as const;
export type ComplaintCategoryValue = typeof ComplaintCategory[keyof typeof ComplaintCategory];

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

export interface InventoryPatternDefinition {
  keys: string[];
  /** Literal text before, between and after values. Always keys.length + 1 entries. */
  literals: string[];
  custom: boolean;
}

const LEGACY_INVENTORY_KEY_PATTERN = /^[a-z0-9][a-z0-9_]{0,63}$/;
const UNSAFE_INVENTORY_KEY_PATTERN = /[.$\u0000-\u001F\u007F{}]/u;

/**
 * Supports the compact legacy form (`email----password`) and a fully custom
 * form (`Email={{email}} | Pass={{password}}`). Literal text is preserved so
 * an imported row can be decoded without guessing which value belongs to a key.
 */
export function parseInventoryPatternTemplate(value: string): InventoryPatternDefinition {
  const pattern = value.trim();
  if (!pattern) throw new Error('Inventory pattern is empty');
  if (pattern.includes('{{') || pattern.includes('}}')) return parseCustomInventoryPattern(pattern);

  const parts = pattern.split(/([^A-Za-z0-9_]+)/);
  const keys = parts.filter((_, index) => index % 2 === 0);
  const separators = parts.filter((_, index) => index % 2 === 1);
  if (!keys.length || keys.some((key) => !LEGACY_INVENTORY_KEY_PATTERN.test(key))) {
    throw new Error('Inventory pattern must use field keys or {{key}} placeholders');
  }
  return { keys, literals: ['', ...separators, ''], custom: false };
}

export function parseInventoryPatternLine(line: string, definition: InventoryPatternDefinition) {
  const { keys, literals } = definition;
  const prefix = literals[0] ?? '';
  if (!line.startsWith(prefix)) throw new Error(`missing prefix “${prefix}”`);
  let cursor = prefix.length;
  const values: string[] = [];
  for (let index = 0; index < keys.length; index++) {
    const nextLiteral = literals[index + 1] ?? '';
    if (index === keys.length - 1) {
      if (nextLiteral && !line.endsWith(nextLiteral)) throw new Error(`missing suffix “${nextLiteral}”`);
      const end = nextLiteral ? line.length - nextLiteral.length : line.length;
      if (end < cursor) throw new Error('does not match the configured pattern');
      values.push(line.slice(cursor, end));
      cursor = line.length;
      continue;
    }
    const position = line.indexOf(nextLiteral, cursor);
    if (position < 0) throw new Error(`missing separator “${nextLiteral}”`);
    values.push(line.slice(cursor, position));
    cursor = position + nextLiteral.length;
  }
  return Object.fromEntries(keys.map((key, index) => [key, values[index] ?? '']));
}

export function inventoryPatternExample(definition: InventoryPatternDefinition) {
  let output = definition.literals[0] ?? '';
  definition.keys.forEach((key, index) => {
    output += key === 'email' ? 'email@gmail.com' : key === 'password' ? 'matkhau' : key;
    output += definition.literals[index + 1] ?? '';
  });
  return output;
}

/** Renders one decrypted inventory payload with the exact literals and field
 * order configured for imports (for example email----password----2fa). */
export function formatInventoryPatternPayload(payload: Record<string, unknown>, definition: InventoryPatternDefinition) {
  let output = definition.literals[0] ?? '';
  definition.keys.forEach((key, index) => {
    const value = payload[key];
    output += value === undefined || value === null ? '' : String(value);
    output += definition.literals[index + 1] ?? '';
  });
  return output;
}

function parseCustomInventoryPattern(pattern: string): InventoryPatternDefinition {
  const matcher = /\{\{\s*([^{}]+?)\s*\}\}/gu;
  const keys: string[] = [];
  const literals: string[] = [];
  let cursor = 0;
  for (const match of pattern.matchAll(matcher)) {
    literals.push(pattern.slice(cursor, match.index));
    const key = match[1].trim();
    if (!key || key.length > 64 || UNSAFE_INVENTORY_KEY_PATTERN.test(key)) {
      throw new Error(`Custom inventory pattern contains an unsafe key: ${key || '(empty)'}`);
    }
    keys.push(key);
    cursor = (match.index ?? 0) + match[0].length;
  }
  literals.push(pattern.slice(cursor));
  if (!keys.length || literals.some((literal) => literal.includes('{{') || literal.includes('}}'))) {
    throw new Error('Custom inventory pattern contains an invalid {{key}} placeholder');
  }
  if (keys.length > 1 && literals.slice(1, -1).some((literal) => !literal)) {
    throw new Error('Custom inventory pattern needs literal text between placeholders');
  }
  return { keys, literals, custom: true };
}
