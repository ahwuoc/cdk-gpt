import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import {
  ActorType, Order, OrderRepository, PaymentMethod, Product, UserRepository,
  WalletReferenceType, WalletTransactionRepository,
} from '@store/database';
import { IdempotencyConflictError, InsufficientBalanceError, InventoryStatus, OrderStatus, OutOfStockError, ProductStatus, WalletTransactionType, isMongoDuplicateKey } from '@store/shared';
import { DELIVERY_QUEUE, type DeliveryQueueClient } from '../delivery/delivery.queue';
import { InventoryReservationService } from '../inventory/inventory-reservation.service';
import type { PurchaseDto } from './purchase.dto';

@Injectable()
export class PurchaseService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('Order') private readonly orderModel: Model<Order>,
    private readonly users: UserRepository,
    private readonly inventory: InventoryReservationService,
    private readonly orders: OrderRepository,
    private readonly walletTransactions: WalletTransactionRepository,
    @Inject(DELIVERY_QUEUE) private readonly deliveryQueue: DeliveryQueueClient,
  ) {}

  async purchase(input: PurchaseDto) {
    const prior = await this.orders.findByIdempotencyKey(input.idempotencyKey);
    if (prior) {
      this.assertSameRequest(prior, input);
      if (prior.status === OrderStatus.PENDING_DELIVERY) await this.deliveryQueue.enqueue(prior._id.toString());
      return prior;
    }
    const session = await this.connection.startSession();
    let order: Awaited<ReturnType<OrderRepository['create']>> | undefined;
    try {
      await session.withTransaction(async () => {
        const existing = await this.orders.findByIdempotencyKey(input.idempotencyKey, session);
        if (existing) { this.assertSameRequest(existing, input); order = existing; return; }

        const userId = new Types.ObjectId(input.userId);
        const productId = new Types.ObjectId(input.productId);
        const user = await this.users.findActive(userId, session);
        if (!user) throw new Error('User is not active');
        const product = await this.products.findOne({ _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).session(session);
        if (!product) throw new Error('Product is not available for sale');
        if (product.price !== input.expectedUnitPrice) throw new Error('Product price changed; confirm the current price');
        if (user.walletBalance < product.price) throw new InsufficientBalanceError();
        if (product.purchaseLimitPerUser > 0) {
          const purchased = await this.orderModel.countDocuments({ userId, productId, status: { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } }).session(session);
          if (purchased >= product.purchaseLimitPerUser) throw new Error('Purchase limit reached');
        }

        const orderId = new Types.ObjectId();
        const reserved = await this.inventory.reserveOne({
          productId, userId, orderId, session, expiresAt: new Date(Date.now() + 15 * 60_000),
        });
        if (!reserved) throw new OutOfStockError();

        order = await this.orders.create({
          _id: orderId, orderCode: this.orderCode(), userId, productId, inventoryItemId: reserved._id,
          quantity: 1, unitPrice: product.price, totalAmount: product.price,
          status: OrderStatus.PENDING_DELIVERY, paymentMethod: PaymentMethod.WALLET,
          deliveryStatus: 'PENDING', idempotencyKey: input.idempotencyKey, metadata: {},
        } as Partial<Order>, session);

        const debited = await this.users.debit(userId, product.price, session);
        if (!debited) throw new InsufficientBalanceError();
        const walletTransaction = await this.walletTransactions.create({
          userId, balanceBefore: user.walletBalance, balanceAfter: debited.walletBalance, amount: -product.price,
          type: WalletTransactionType.PURCHASE, reason: `Purchase ${order.orderCode}`,
          referenceType: WalletReferenceType.ORDER, referenceId: order._id,
          idempotencyKey: `purchase:${input.idempotencyKey}`, actorType: ActorType.USER, actorId: userId, metadata: {},
        }, session);
        await this.orders.attachWalletTransaction(order._id, walletTransaction._id, session);
        order.walletTransactionId = walletTransaction._id;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } catch (error) {
      if (isMongoDuplicateKey(error)) {
        const concurrent = await this.orders.findByIdempotencyKey(input.idempotencyKey);
        if (concurrent) {
          this.assertSameRequest(concurrent, input);
          if (concurrent.status === OrderStatus.PENDING_DELIVERY) await this.deliveryQueue.enqueue(concurrent._id.toString());
          return concurrent;
        }
      }
      throw error;
    } finally { await session.endSession(); }
    if (!order) throw new Error('Purchase transaction did not produce an order');
    await this.deliveryQueue.enqueue(order._id.toString());
    return order;
  }

  private orderCode() {
    return `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private assertSameRequest(order: Order, input: PurchaseDto) {
    if (order.userId.toString() !== input.userId || order.productId.toString() !== input.productId ||
      order.unitPrice !== input.expectedUnitPrice) throw new IdempotencyConflictError();
  }
}
