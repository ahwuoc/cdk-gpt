export interface InventoryFormatField {
  name: string;
  key: string;
  visibleToCustomer: boolean;
  sortOrder: number;
}

export function normalizeProductFieldKey(value: string) {
  return value.slice(0, 64);
}

export function synchronizedInventoryFormat(fields: InventoryFormatField[]) {
  const ordered = [...fields].sort((left, right) => left.sortOrder - right.sortOrder);
  const visible = ordered.filter((field) => field.visibleToCustomer);
  return {
    inventoryPattern: ordered.map((field) => `{{${field.key.trim()}}}`).join('----'),
    deliveryTemplate: visible.length
      ? visible.map((field) => `${field.name.trim() || field.key}: {{${field.key}}}`).join('\n')
      : 'Dữ liệu: {{payload}}',
  };
}

export function unknownDeliveryTemplateKeys(fields: InventoryFormatField[], template: string) {
  const keys = new Set(fields.map((field) => field.key));
  return deliveryTemplateKeys(template)
    .filter((key, index, all) => key !== 'payload' && !keys.has(key) && all.indexOf(key) === index);
}

export function missingDeliveryTemplateKeys(fields: InventoryFormatField[], template: string) {
  const templateKeys = new Set(deliveryTemplateKeys(template));
  return [...fields].sort((left, right) => left.sortOrder - right.sortOrder)
    .filter((field) => field.visibleToCustomer && !templateKeys.has(field.key))
    .map((field) => field.key);
}

function deliveryTemplateKeys(template: string) {
  return [...template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu)].map((match) => match[1].trim());
}
