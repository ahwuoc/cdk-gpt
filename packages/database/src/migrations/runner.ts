import type { Connection } from 'mongoose';
import { MigrationRecordModel, type MigrationRecord } from '../schemas';
import { migrations } from './index';

export class MigrationRunner {
  constructor(private readonly connection: Connection) {}

  async status() {
    await MigrationRecordModel.createIndexes();
    const applied = await MigrationRecordModel.find().sort({ name: 1 }).lean<MigrationRecord[]>();
    const byName = new Map(applied.map((record) => [record.name, record]));
    return migrations.map((migration) => ({
      name: migration.name,
      status: byName.has(migration.name) ? 'applied' as const : 'pending' as const,
      checksumValid: !byName.has(migration.name) || byName.get(migration.name)!.checksum === migration.checksum,
      appliedAt: byName.get(migration.name)?.appliedAt,
    }));
  }

  async up() {
    await MigrationRecordModel.createIndexes();
    const applied = new Map((await MigrationRecordModel.find().lean<MigrationRecord[]>()).map((record) => [record.name, record]));
    for (const migration of migrations) {
      const previous = applied.get(migration.name);
      if (previous) {
        if (previous.checksum !== migration.checksum) throw new Error(`Checksum mismatch for applied migration ${migration.name}`);
        continue;
      }
      const started = performance.now();
      await migration.up(this.connection);
      await MigrationRecordModel.create({ name: migration.name, checksum: migration.checksum, appliedAt: new Date(), executionMs: Math.round(performance.now() - started) });
    }
  }

  async down() {
    await MigrationRecordModel.createIndexes();
    const latest = await MigrationRecordModel.findOne().sort({ appliedAt: -1 });
    if (!latest) return;
    const migration = migrations.find((item) => item.name === latest.name);
    if (!migration) throw new Error(`Migration code not found for ${latest.name}`);
    await migration.down(this.connection);
    await latest.deleteOne();
  }
}
