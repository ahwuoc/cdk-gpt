import { Types } from 'mongoose';
import { InventoryItemModel, OrderModel, ProductModel } from '@store/database';
import { EncryptionService } from '@store/encryption';
import { formatCustomerInventoryPayload } from '@store/shared';
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
    .select('orderCode userId productId inventoryItemId metadata deliveredAt')
    .lean();
  if (!order || order.metadata?.deliveryAccessToken !== token) return null;

  const paymentRequestId = typeof order.metadata?.paymentRequestId === 'string' ? order.metadata.paymentRequestId : undefined;
  const groupedOrders = paymentRequestId ? await OrderModel.find({
    userId: order.userId,
    productId: order.productId,
    'metadata.paymentRequestId': paymentRequestId,
    'metadata.deliveryAccessToken': token,
  }).select('orderCode inventoryItemId deliveredAt createdAt').sort({ createdAt: 1, _id: 1 }).lean() : [order];
  if (!groupedOrders.some((item) => item._id.equals(order._id))) return null;

  const [product, inventories] = await Promise.all([
    ProductModel.findById(order.productId).select('name description instructions warrantyPolicy warrantyDays deliveryTemplate inventoryPattern fieldDefinitions').lean(),
    InventoryItemModel.find({ _id: { $in: groupedOrders.map((item) => item.inventoryItemId) } }).select('+encryptedPayload').lean(),
  ]);
  if (!product || inventories.length !== groupedOrders.length) return null;

  const inventoryById = new Map(inventories.map((item) => [item._id.toString(), item]));
  const formattedItems = groupedOrders.map((item, index) => {
    const inventory = inventoryById.get(item.inventoryItemId.toString());
    if (!inventory?.encryptedPayload) return '';
    const payload = EncryptionService.fromEnvironment().decrypt<Record<string, unknown>>(inventory.encryptedPayload);
    const formatted = renderDelivery(product.inventoryPattern, product.deliveryTemplate,
      product.fieldDefinitions, payload).trim();
    return groupedOrders.length > 1 ? `${index + 1}. ${item.orderCode}: ${formatted}` : formatted;
  }).filter(Boolean);
  if (formattedItems.length !== groupedOrders.length) return null;

  return {
    orderId: order._id.toString(),
    orderCode: groupedOrders.map((item) => item.orderCode).join(', '),
    productName: product.name,
    productDescription: product.description ?? '',
    instructions: product.instructions ?? '',
    warrantyPolicy: product.warrantyPolicy ?? '',
    warrantyDays: product.warrantyDays ?? 0,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    formatted: formattedItems.join('\n\n'),
    payload: {},
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
  const code = data.orderCode.split(',')[0]?.trim() || 'order';
  return `${code}-${name}.txt`;
}

function renderDelivery(pattern: string | undefined, template: string,
  fields: Array<{ key: string; visibleToCustomer: boolean }>, payload: Record<string, unknown>) {
  if (pattern?.trim()) {
    try {
      return formatCustomerInventoryPayload(payload, pattern,
        fields.filter((field) => field.visibleToCustomer).map((field) => field.key));
    } catch { /* Legacy products without a valid pattern still use their delivery template. */ }
  }
  return renderTemplate(template, payload);
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
