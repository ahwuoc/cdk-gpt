import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import {
  ActorType, Order, OrderRepository, PaymentMethod, Product, UserRepository,
  WalletReferenceType, WalletTransactionRepository,
} from '@store/database';
import { IdempotencyConflictError, InsufficientBalanceError, InventoryStatus, OrderStatus, OutOfStockError, ProductStatus, WalletTransactionType, isMongoDuplicateKey } from '@store/shared';
import { DELIVERY_QUEUE, type DeliveryQueueClient } from '../delivery/delivery.queue';
import { InventoryReservationService } from '../inventory/inventory-reservation.service';
import type { PurchaseDto } from './purchase.dto';

export interface PurchaseBatchInput {
  userId: string;
  productId: string;
  expectedUnitPrice: number;
  quantity: number;
  idempotencyPrefix: string;
  paymentRequestId?: string;
}

export interface PurchaseQuote {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  available: number;
}

export interface ReserveBatchForPaymentInput {
  userId: string;
  productId: string;
  expectedUnitPrice: number;
  quantity: number;
  paymentRequestId: string;
  expiresAt: Date;
}

type BatchOrder = Order & { _id: Types.ObjectId };

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
        // Serialize every purchase for this customer with QR checkout creation.
        // Otherwise a wallet purchase could consume the same per-user
        // entitlement while a bank-payment reservation is still active.
        await this.users.lockForCheckout(userId, session);
        const product = await this.products.findOne({ _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).session(session);
        if (!product) throw new Error('Product is not available for sale');
        if (product.price !== input.expectedUnitPrice) throw new Error('Product price changed; confirm the current price');
        if (user.walletBalance < product.price) throw new InsufficientBalanceError();
        if (product.purchaseLimitPerUser > 0) {
          await this.inventory.releaseExpiredPaymentReservationsForProduct(productId, session);
          const held = await this.inventory.countActivePaymentReservations(productId, userId, session);
          const purchased = await this.orderModel.countDocuments({ userId, productId, status: { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } }).session(session);
          if (purchased + held + 1 > product.purchaseLimitPerUser) throw new Error('Purchase limit reached');
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

  async quoteBatch(input: Omit<PurchaseBatchInput, 'idempotencyPrefix' | 'paymentRequestId'>): Promise<PurchaseQuote> {
    this.validateBatchInput({ ...input, idempotencyPrefix: 'quote-only' });
    const userId = new Types.ObjectId(input.userId);
    const productId = new Types.ObjectId(input.productId);
    const [user, product] = await Promise.all([
      this.users.findActive(userId),
      this.products.findOne({ _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }),
    ]);
    if (!user) throw new Error('User is not active');
    if (!product) throw new Error('Product is not available for sale');
    if (product.price !== input.expectedUnitPrice) throw new Error('Product price changed; confirm the current price');
    const totalAmount = product.price * input.quantity;
    if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) throw new Error('Invalid checkout total');
    const available = await this.inventory.countAvailable(productId);
    if (available < input.quantity) throw new OutOfStockError();
    if (product.purchaseLimitPerUser > 0) {
      const purchased = await this.orderModel.countDocuments({ userId, productId,
        status: { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } });
      if (purchased + input.quantity > product.purchaseLimitPerUser) throw new Error('Purchase limit reached');
    }
    return { productId: product._id.toString(), productName: product.name, unitPrice: product.price,
      quantity: input.quantity, totalAmount, available };
  }

  /** Holds the complete checkout quantity until its QR expires. The caller
   * must create the PaymentRequest in the same MongoDB transaction. */
  async reserveBatchForPayment(input: ReserveBatchForPaymentInput, session: ClientSession): Promise<PurchaseQuote> {
    this.validateBatchInput({ ...input, idempotencyPrefix: 'payment-reservation' });
    if (!Types.ObjectId.isValid(input.paymentRequestId) || input.expiresAt.getTime() <= Date.now()) {
      throw new Error('Invalid payment reservation');
    }
    const userId = new Types.ObjectId(input.userId);
    const productId = new Types.ObjectId(input.productId);
    const paymentRequestId = new Types.ObjectId(input.paymentRequestId);
    const user = await this.users.findActive(userId, session);
    if (!user) throw new Error('User is not active');
    await this.users.lockForCheckout(userId, session);
    const product = await this.products.findOne({ _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).session(session);
    if (!product) throw new Error('Product is not available for sale');
    if (product.price !== input.expectedUnitPrice) throw new Error('Product price changed; confirm the current price');
    const totalAmount = product.price * input.quantity;
    if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) throw new Error('Invalid checkout total');
    await this.inventory.releaseExpiredPaymentReservationsForProduct(productId, session);
    const activeReservations = await this.inventory.countActivePaymentReservations(productId, userId, session);
    if (activeReservations > 0) throw new Error('An active checkout already holds this product; use its QR or wait for expiry');
    if (product.purchaseLimitPerUser > 0) {
      const purchased = await this.orderModel.countDocuments({ userId, productId,
        status: { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } }).session(session);
      if (purchased + activeReservations + input.quantity > product.purchaseLimitPerUser) throw new Error('Purchase limit reached');
    }
    const available = await this.inventory.countAvailable(productId, session);
    if (available < input.quantity) throw new OutOfStockError();
    for (let index = 0; index < input.quantity; index++) {
      const reserved = await this.inventory.reserveForPayment({ productId, userId, paymentRequestId,
        expiresAt: input.expiresAt, session });
      if (!reserved) throw new OutOfStockError();
    }
    return { productId: product._id.toString(), productName: product.name, unitPrice: product.price,
      quantity: input.quantity, totalAmount, available };
  }

  async releaseBankCheckoutReservation(paymentRequestId: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(paymentRequestId)) throw new Error('Invalid payment request');
    const objectId = new Types.ObjectId(paymentRequestId);
    if (session) return this.inventory.releasePaymentReservations(objectId, session);
    const ownSession = await this.connection.startSession();
    try {
      let modifiedCount = 0;
      await ownSession.withTransaction(async () => {
        const result = await this.inventory.releasePaymentReservations(objectId, ownSession);
        modifiedCount = result.modifiedCount;
      });
      return { modifiedCount };
    } finally { await ownSession.endSession(); }
  }

  extendBankCheckoutReservation(paymentRequestId: string, expiresAt: Date, session: ClientSession) {
    if (!Types.ObjectId.isValid(paymentRequestId)) throw new Error('Invalid payment request');
    return this.inventory.extendPaymentReservations(new Types.ObjectId(paymentRequestId), expiresAt, session);
  }

  async bankCheckoutUserIsActive(userId: string, session: ClientSession) {
    return Types.ObjectId.isValid(userId) && Boolean(await this.users.findActive(new Types.ObjectId(userId), session));
  }

  async redispatchPendingOrders(orderIds: string[]) {
    const ids = orderIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (!ids.length) return;
    const pending = await this.orderModel.find({ _id: { $in: ids }, status: OrderStatus.PENDING_DELIVERY,
      deliveryStatus: 'PENDING' }).exec() as BatchOrder[];
    await this.enqueueBatch(pending);
  }

  /**
   * Creates one delivery order per inventory item, but reserves and charges the
   * whole requested quantity in one MongoDB transaction. A callback retry uses
   * deterministic item keys and therefore returns the same orders.
   */
  async purchaseBatch(input: PurchaseBatchInput) {
    this.validateBatchInput(input);
    const keys = this.batchKeys(input);
    const prior = await this.findBatch(keys);
    if (prior.length) {
      const complete = this.assertCompleteBatch(prior, input, keys);
      await this.enqueueBatch(complete);
      return complete;
    }

    const session = await this.connection.startSession();
    let created: BatchOrder[] = [];
    try {
      await session.withTransaction(async () => {
        created = await this.purchaseBatchInSession(input, session);
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } catch (error) {
      if (isMongoDuplicateKey(error)) {
        const concurrent = await this.findBatch(keys);
        if (concurrent.length) created = this.assertCompleteBatch(concurrent, input, keys);
        else throw error;
      } else throw error;
    } finally { await session.endSession(); }
    await this.enqueueBatch(created);
    return created;
  }

  async purchaseBatchInSession(input: PurchaseBatchInput, session: ClientSession) {
    this.validateBatchInput(input);
    const keys = this.batchKeys(input);
    const existing = await this.findBatch(keys, session);
    if (existing.length) return this.assertCompleteBatch(existing, input, keys);
    return this.createBatch(input, keys, session);
  }

  dispatchBatch(orders: Array<{ _id: Types.ObjectId }>) { return this.enqueueBatch(orders); }

  private async createBatch(input: PurchaseBatchInput, keys: string[], session: ClientSession): Promise<BatchOrder[]> {
    const userId = new Types.ObjectId(input.userId);
    const productId = new Types.ObjectId(input.productId);
    const paymentRequestId = input.paymentRequestId ? new Types.ObjectId(input.paymentRequestId) : undefined;
    const user = await this.users.findActive(userId, session);
    if (!user) throw new Error('User is not active');
    const product = await this.products.findOne(paymentRequestId
      ? { _id: productId }
      : { _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).session(session);
    if (!product) throw new Error('Product is not available for sale');
    if (!paymentRequestId && product.price !== input.expectedUnitPrice) throw new Error('Product price changed; confirm the current price');
    const unitPrice = paymentRequestId ? input.expectedUnitPrice : product.price;
    const total = unitPrice * input.quantity;
    if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Invalid checkout total');
    if (user.walletBalance < total) throw new InsufficientBalanceError();
    // A paid checkout consumes the price, eligibility and stock that were
    // locked when its QR was created; later admin edits cannot invalidate it.
    if (!paymentRequestId && product.purchaseLimitPerUser > 0) {
      const purchased = await this.orderModel.countDocuments({ userId, productId,
        status: { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } }).session(session);
      if (purchased + input.quantity > product.purchaseLimitPerUser) throw new Error('Purchase limit reached');
    }

    const heldItems = paymentRequestId
      ? await this.inventory.findPaymentReservations(paymentRequestId, session)
      : undefined;
    if (heldItems && heldItems.length !== input.quantity) throw new OutOfStockError();
    if (heldItems?.some((item) => !item.productId.equals(productId) || !item.reservedByUserId?.equals(userId))) {
      throw new IdempotencyConflictError();
    }

    const created: BatchOrder[] = [];
    let balanceBefore = user.walletBalance;
    for (let index = 0; index < input.quantity; index++) {
      const orderId = new Types.ObjectId();
      const held = heldItems?.[index];
      const reserved = held && paymentRequestId
        ? await this.inventory.assignPaymentReservation(held._id, paymentRequestId, orderId,
          new Date(Date.now() + 15 * 60_000), session)
        : await this.inventory.reserveOne({ productId, userId, orderId, session,
          expiresAt: new Date(Date.now() + 15 * 60_000) });
      if (!reserved) throw new OutOfStockError();
      const order = await this.orders.create({
        _id: orderId, orderCode: this.orderCode(), userId, productId, inventoryItemId: reserved._id,
        quantity: 1, unitPrice, totalAmount: unitPrice,
        status: OrderStatus.PENDING_DELIVERY, paymentMethod: PaymentMethod.WALLET,
        deliveryStatus: 'PENDING', idempotencyKey: keys[index],
        metadata: { source: 'bank-quick-checkout', paymentRequestId: input.paymentRequestId },
      } as Partial<Order>, session) as BatchOrder;
      const debited = await this.users.debit(userId, unitPrice, session);
      if (!debited) throw new InsufficientBalanceError();
      const walletTransaction = await this.walletTransactions.create({
        userId, balanceBefore, balanceAfter: debited.walletBalance, amount: -unitPrice,
        type: WalletTransactionType.PURCHASE, reason: `Purchase ${order.orderCode}`,
        referenceType: WalletReferenceType.ORDER, referenceId: order._id,
        idempotencyKey: `purchase:${keys[index]}`, actorType: ActorType.USER, actorId: userId,
        metadata: { source: 'bank-quick-checkout', paymentRequestId: input.paymentRequestId },
      }, session);
      await this.orders.attachWalletTransaction(order._id, walletTransaction._id, session);
      order.walletTransactionId = walletTransaction._id;
      balanceBefore = debited.walletBalance;
      created.push(order);
    }
    return created;
  }

  private validateBatchInput(input: PurchaseBatchInput) {
    if (!Types.ObjectId.isValid(input.userId) || !Types.ObjectId.isValid(input.productId)) throw new Error('Invalid checkout identity');
    if (!Number.isSafeInteger(input.expectedUnitPrice) || input.expectedUnitPrice < 0) throw new Error('Invalid checkout price');
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new Error('Invalid checkout quantity');
    if (!input.idempotencyPrefix || input.idempotencyPrefix.length > 115) throw new Error('Invalid checkout idempotency key');
    if (input.paymentRequestId && !Types.ObjectId.isValid(input.paymentRequestId)) throw new Error('Invalid payment request');
  }

  private batchKeys(input: PurchaseBatchInput) {
    return Array.from({ length: input.quantity }, (_, index) => `${input.idempotencyPrefix}:${index}`);
  }

  private async findBatch(keys: string[], session?: ClientSession): Promise<BatchOrder[]> {
    return await this.orderModel.find({ idempotencyKey: { $in: keys } }).session(session ?? null).exec() as BatchOrder[];
  }

  private assertCompleteBatch(found: BatchOrder[], input: PurchaseBatchInput, keys: string[]) {
    if (found.length !== input.quantity) throw new IdempotencyConflictError();
    const byKey = new Map(found.map((order) => [order.idempotencyKey, order]));
    return keys.map((key) => {
      const order = byKey.get(key);
      if (!order || order.userId.toString() !== input.userId || order.productId.toString() !== input.productId ||
        order.unitPrice !== input.expectedUnitPrice) throw new IdempotencyConflictError();
      return order;
    });
  }

  private async enqueueBatch(orders: Array<{ _id: Types.ObjectId }>) {
    for (const order of orders) {
      try { await this.deliveryQueue.enqueue(order._id.toString()); }
      catch (error) {
        // The committed PENDING_DELIVERY order is the durable outbox. Scheduled
        // maintenance republishes pending orders, so a transient QStash/Redis
        // failure must not turn an already-paid checkout into a failed sale.
        console.error({ event: 'quick-checkout-delivery-enqueue-failed', orderId: order._id.toString(),
          message: error instanceof Error ? error.message : 'unknown error' });
      }
    }
  }

  private orderCode() {
    return `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private assertSameRequest(order: Order, input: PurchaseDto) {
    if (order.userId.toString() !== input.userId || order.productId.toString() !== input.productId ||
      order.unitPrice !== input.expectedUnitPrice) throw new IdempotencyConflictError();
  }
}
