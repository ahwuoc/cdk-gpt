import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, Types } from 'mongoose';
import { UserStatus } from '@store/shared';
import { User } from '../schemas';

@Injectable()
export class UserRepository {
  constructor(@InjectModel('User') private readonly users: Model<User>) {}

  findActive(id: Types.ObjectId, session?: ClientSession) {
    return this.users.findOne({ _id: id, status: UserStatus.ACTIVE, deletedAt: null }).session(session ?? null).exec();
  }

  debit(id: Types.ObjectId, amount: number, session: ClientSession) {
    return this.users.findOneAndUpdate(
      { _id: id, status: UserStatus.ACTIVE, deletedAt: null, walletBalance: { $gte: amount } },
      { $inc: { walletBalance: -amount, purchaseCount: 1 } },
      { new: true, session, runValidators: true },
    );
  }

  debitBalance(id: Types.ObjectId, amount: number, session: ClientSession) {
    return this.users.findOneAndUpdate(
      { _id: id, status: UserStatus.ACTIVE, deletedAt: null, walletBalance: { $gte: amount } },
      { $inc: { walletBalance: -amount } }, { new: true, session, runValidators: true },
    );
  }

  credit(id: Types.ObjectId, amount: number, session: ClientSession) {
    return this.users.findOneAndUpdate(
      { _id: id, status: UserStatus.ACTIVE, deletedAt: null }, { $inc: { walletBalance: amount } },
      { new: true, session, runValidators: true },
    );
  }
}
