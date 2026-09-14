import { Types } from 'mongoose';
import { InventoryItemModel, OrderModel, ProductModel } from '@store/database';
import { EncryptionService } from '@store/encryption';
import { getServerlessApi } from '../../api/src/serverless';

export interface PublicDeliveryData {
  orderId: string;
  orderCode: string;
  productName: string;
  productDescription: string;
  instructions: string;
  warrantyPolicy: string;
  warrantyDays: number;
  deliveredAt: string | null;
  formatted: string;
  payload: Record<string, unknown>;
}


export async function getPublicDelivery(orderId: string, token: string): Promise<PublicDeliveryData | null> {
  if (!Types.ObjectId.isValid(orderId) || !validToken(token)) return null;
  await getServerlessApi();
  const order = await OrderModel.findById(orderId)
    .select('orderCode productId inventoryItemId metadata deliveredAt deliveryStatus status')
    .lean();
  if (!order || order.metadata?.deliveryAccessToken !== token) return null;
  const [product, inventory] = await Promise.all([
    ProductModel.findById(order.productId).select('name description instructions warrantyPolicy warrantyDays deliveryTemplate').lean(),
    InventoryItemModel.findById(order.inventoryItemId).select('+encryptedPayload').lean(),
  ]);
  if (!product || !inventory?.encryptedPayload) return null;
  const payload = EncryptionService.fromEnvironment().decrypt<Record<string, unknown>>(inventory.encryptedPayload);
  const formatted = renderTemplate(product.deliveryTemplate, payload).trim();
  return {
    orderId: order._id.toString(),
    orderCode: order.orderCode,
    productName: product.name,
    productDescription: product.description ?? '',
    instructions: product.instructions ?? '',
    warrantyPolicy: product.warrantyPolicy ?? '',
    warrantyDays: product.warrantyDays ?? 0,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    formatted,
    payload,
  };
}

export function deliveryTextFile(data: PublicDeliveryData) {
  const blocks = [
    `${data.productName}`,
    `Mã đơn: ${data.orderCode}`,
    '',
    '=== TÀI KHOẢN ===',
    data.formatted,
  ];
  if (data.instructions.trim()) blocks.push('', '=== HƯỚNG DẪN SỬ DỤNG ===', data.instructions.trim());
  if (data.warrantyPolicy.trim() || data.warrantyDays > 0) blocks.push('', '=== BẢO HÀNH ===', [
    data.warrantyDays > 0 ? `Số ngày bảo hành: ${data.warrantyDays}` : '',
    data.warrantyPolicy.trim(),
  ].filter(Boolean).join('\n'));
  return `${blocks.join('\n')}\n`;
}

export function safeDeliveryFilename(data: Pick<PublicDeliveryData, 'orderCode' | 'productName'>) {
  const name = data.productName.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tai-khoan';
  return `${data.orderCode}-${name}.txt`;
}

function renderTemplate(template: string, payload: Record<string, unknown>) {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (_, key: string) => {
    const value = payload[key.trim()];
    return value === undefined || value === null ? '' : String(value);
  });
}

function validToken(token: string) {
  return /^[A-Za-z0-9_-]{24,128}$/.test(token);
}
