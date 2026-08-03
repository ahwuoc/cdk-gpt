import mongoose from 'mongoose';
import { loadConfig } from '@store/config';
import '../schemas';
import { MigrationRunner } from './runner';

const command = process.argv[2];
if (!['up', 'down', 'status'].includes(command ?? '')) {
  console.error('Usage: bun packages/database/src/migrations/cli.ts <up|down|status>');
  process.exit(1);
}

const config = loadConfig();
await mongoose.connect(config.mongoUri, { autoIndex: false });
try {
  const runner = new MigrationRunner(mongoose.connection);
  if (command === 'up') await runner.up();
  if (command === 'down') await runner.down();
  const rows = await runner.status();
  console.table(rows);
} finally {
  await mongoose.disconnect();
}
