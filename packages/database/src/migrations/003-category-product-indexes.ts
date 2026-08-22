import { createHash } from 'node:crypto';
import type { Connection } from 'mongoose';
import '../schemas';
import type { MongoMigration } from './types';

const source = '003-category-product-indexes-v1';
const models = ['Category', 'Product'];

export const categoryProductIndexesMigration: MongoMigration = {
  name: '003-category-product-indexes',
  checksum: createHash('sha256').update(source).digest('hex'),
  async up(connection: Connection) {
    for (const name of models) {
      const model = connection.models[name];
      if (model) await model.createIndexes();
    }
  },
  async down(connection: Connection) {
    for (const name of models) {
      const model = connection.models[name];
      if (!model) continue;
      const declaredNames = model.schema.indexes().map(([keys, options]) => options.name ??
        Object.entries(keys).map(([field, direction]) => `${field}_${direction}`).join('_'));
      const existingNames = new Set((await model.collection.indexes()).map((index) => index.name));
      for (const indexName of declaredNames) if (existingNames.has(indexName)) await model.collection.dropIndex(indexName);
    }
  },
};
