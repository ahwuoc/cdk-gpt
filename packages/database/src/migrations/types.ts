import type { Connection } from 'mongoose';

export interface MongoMigration {
  name: string;
  checksum: string;
  up(connection: Connection): Promise<void>;
  down(connection: Connection): Promise<void>;
}
