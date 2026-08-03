import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { WalletTransaction } from '../schemas';

@Injectable()
export class WalletTransactionRepository {
  constructor(@InjectModel('WalletTransaction') private readonly transactions: Model<WalletTransaction>) {}
  findByIdempotencyKey(key: string, session?: ClientSession) {
    return this.transactions.findOne({ idempotencyKey: key }).session(session ?? null).exec();
  }
  create(data: Partial<WalletTransaction>, session: ClientSession) {
    return this.transactions.create([data], { session }).then(([transaction]) => transaction);
  }
}
