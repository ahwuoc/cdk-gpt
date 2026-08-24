import { expect, test } from 'bun:test';
import { validate } from 'class-validator';
import { ProductFieldDefinitionDto } from '../apps/api/src/product/product.dto';

test('product inventory keys may use free text', async () => {
  const field = Object.assign(new ProductFieldDefinitionDto(), {
    name: '2FA', key: 'Mã 2FA tùy ý', type: 'STRING', sensitive: true,
    visibleToCustomer: true, required: true, sortOrder: 3,
  });
  expect(await validate(field)).toHaveLength(0);
});
