import { expect, test } from 'bun:test';
import { missingDeliveryTemplateKeys, normalizeProductFieldKey,
  synchronizedInventoryFormat } from '../apps/admin-web/app/admin/product-form-utils';

test('inventory format sync replaces stale placeholders and includes every customer-visible field', () => {
  const fields = [
    { name: 'email', key: 'email', visibleToCustomer: true, sortOrder: 1 },
    { name: 'Mật khẩu', key: 'password', visibleToCustomer: true, sortOrder: 2 },
    { name: '2FA', key: 'Mã 2FA', visibleToCustomer: true, sortOrder: 3 },
  ];

  expect(synchronizedInventoryFormat(fields)).toEqual({
    inventoryPattern: '{{email}}----{{password}}----{{Mã 2FA}}',
    deliveryTemplate: '{{email}}----{{password}}----{{Mã 2FA}}',
  });
  expect(missingDeliveryTemplateKeys(fields, 'Email: {{email}}')).toEqual(['password', 'Mã 2FA']);
});

test('a field key is free text and may begin with a number', () => {
  expect(normalizeProductFieldKey('2FA')).toBe('2FA');
  expect(normalizeProductFieldKey('Mã 2FA tùy ý')).toBe('Mã 2FA tùy ý');
});
