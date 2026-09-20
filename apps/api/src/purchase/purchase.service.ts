import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { PURCHASE_ALERT_QUEUE, type PurchaseAlertQueueClient } from './purchase-alert.queue';
import { CouponUnavailableError, CouponsService, normalizeCouponCode, type CouponPricing } from '../coupons/coupons.service';

export interface PurchaseBatchInput {
  userId: string;
  productId: string;
  expectedUnitPrice: number;
  quantity: number;
  couponCode?: string;
  expectedTotalAmount?: number;
  idempotencyPrefix: string;
  paymentRequestId?: string;
  /** New bank QR checkouts are quotes only. They reserve stock atomically
   * after the bank callback, while legacy checkouts still consume their hold. */
  allowUnreservedPayment?: boolean;
}

export interface PurchaseQuote {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  subtotal: number;
  discountAmount: number;
  couponCode?: string;
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

export type SoftCheckoutAvailability = 'AVAILABLE' | 'USER_INACTIVE' | 'PRODUCT_UNAVAILABLE' |
  'PURCHASE_LIMIT' | 'OUT_OF_STOCK';

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
    @Optional() @Inject(PURCHASE_ALERT_QUEUE) private readonly purchaseAlerts?: PurchaseAlertQueueClient,
    @Optional() private readonly coupons?: CouponsService,
  ) {}

  async purchase(input: PurchaseDto) {
    const prior = await this.orders.findByIdempotencyKey(input.idempotencyKey);
    if (prior) {
      this.assertSameRequest(prior, input);
      if (prior.status === OrderStatus.PENDING_DELIVERY) await this.deliveryQueue.enqueue(prior._id.toString());
      await this.enqueuePurchaseAlert(prior._id, prior.userId, prior.productId, 1);
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
          await this.enqueuePurchaseAlert(concurrent._id, concurrent.userId, concurrent.productId, 1);
          return concurrent;
        }
      }
      throw error;
    } finally { await session.endSession(); }
    if (!order) throw new Error('Purchase transaction did not produce an order');
    await this.deliveryQueue.enqueue(order._id.toString());
    await this.enqueuePurchaseAlert(order._id, order.userId, order.productId, 1);
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
    const subtotal = product.price * input.quantity;
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0) throw new Error('Invalid checkout total');
    const pricing = await this.couponPricing(input, subtotal);
    const available = await this.inventory.countAvailable(productId);
    if (available < input.quantity) throw new OutOfStockError();
    if (product.purchaseLimitPerUser > 0) {
      const purchased = await this.orderModel.countDocuments({ userId, productId,
        status: { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } });
      if (purchased + input.quantity > product.purchaseLimitPerUser) throw new Error('Purchase limit reached');
    }
    return { productId: product._id.toString(), productName: product.name, unitPrice: product.price,
      quantity: input.quantity, subtotal, discountAmount: pricing.discountAmount,
      totalAmount: pricing.totalAmount, couponCode: pricing.couponCode, available };
  }

  /** Quotes an unpaid QR inside the caller transaction and serializes other
   * checkout intents for this user. This deliberately does not mutate stock. */
  async quoteBatchForPayment(input: Omit<PurchaseBatchInput,
    'idempotencyPrefix' | 'paymentRequestId' | 'allowUnreservedPayment'>,
  session: ClientSession): Promise<PurchaseQuote> {
    this.validateBatchInput({ ...input, idempotencyPrefix: 'soft-payment-quote' });
    const userId = new Types.ObjectId(input.userId);
    const productId = new Types.ObjectId(input.productId);
    const user = await this.users.findActive(userId, session);
    if (!user) throw new Error('User is not active');
    await this.users.lockForCheckout(userId, session);
    const product = await this.products.findOne({ _id: productId, status: ProductStatus.ACTIVE,
      deletedAt: null }).session(session);
    if (!product) throw new Error('Product is not available for sale');
    if (product.price !== input.expectedUnitPrice) throw new Error('Product price changed; confirm the current price');
    const subtotal = product.price * input.quantity;
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0) throw new Error('Invalid checkout total');
    const pricing = await this.couponPricing(input, subtotal, session);
    const available = await this.inventory.countAvailable(productId, session);
    if (available < input.quantity) throw new OutOfStockError();
    if (product.purchaseLimitPerUser > 0) {
      const purchased = await this.orderModel.countDocuments({ userId, productId,
        status: { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } }).session(session);
      if (purchased + input.quantity > product.purchaseLimitPerUser) throw new Error('Purchase limit reached');
    }
    return { productId: product._id.toString(), productName: product.name, unitPrice: product.price,
      quantity: input.quantity, subtotal, discountAmount: pricing.discountAmount,
      totalAmount: pricing.totalAmount, couponCode: pricing.couponCode, available };
  }

  /** Checks the paid quote under the same per-user lock used by purchases.
   * The caller can safely credit the transfer instead of creating an order
   * when the quote can no longer be fulfilled. */
  async softCheckoutAvailability(input: Omit<PurchaseBatchInput,
    'idempotencyPrefix' | 'paymentRequestId' | 'allowUnreservedPayment'>,
  session: ClientSession): Promise<SoftCheckoutAvailability> {
    this.validateBatchInput({ ...input, idempotencyPrefix: 'soft-payment-check' });
    const userId = new Types.ObjectId(input.userId);
    const productId = new Types.ObjectId(input.productId);
    const user = await this.users.findActive(userId, session);
    if (!user) return 'USER_INACTIVE';
    await this.users.lockForCheckout(userId, session);
    // Honor the quoted price even if the product was paused after QR creation,
    // but never fulfill a product that has been deleted.
    const product = await this.products.findOne({ _id: productId, deletedAt: null }).session(session);
    if (!product) return 'PRODUCT_UNAVAILABLE';
    if (product.purchaseLimitPerUser > 0) {
      const purchased = await this.orderModel.countDocuments({ userId, productId,
        status: { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } }).session(session);
      if (purchased + input.quantity > product.purchaseLimitPerUser) return 'PURCHASE_LIMIT';
    }
    return await this.inventory.countAvailable(productId, session) >= input.quantity
      ? 'AVAILABLE' : 'OUT_OF_STOCK';
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
      quantity: input.quantity, subtotal: totalAmount, discountAmount: 0, totalAmount, available };
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
      await this.dispatchBatch(complete);
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
    await this.dispatchBatch(created);
    return created;
  }

  async purchaseBatchInSession(input: PurchaseBatchInput, session: ClientSession) {
    this.validateBatchInput(input);
    const keys = this.batchKeys(input);
    const existing = await this.findBatch(keys, session);
    if (existing.length) return this.assertCompleteBatch(existing, input, keys);
    return this.createBatch(input, keys, session);
  }

  async dispatchBatch(orders: Array<{ _id: Types.ObjectId }>) {
    await this.enqueueBatch(orders);
    await this.enqueueBatchPurchaseAlert(orders);
  }

  private async createBatch(input: PurchaseBatchInput, keys: string[], session: ClientSession): Promise<BatchOrder[]> {
    const userId = new Types.ObjectId(input.userId);
    const productId = new Types.ObjectId(input.productId);
    const paymentRequestId = input.paymentRequestId ? new Types.ObjectId(input.paymentRequestId) : undefined;
    const user = await this.users.findActive(userId, session);
    if (!user) throw new Error('User is not active');
    await this.users.lockForCheckout(userId, session);
    const product = await this.products.findOne(paymentRequestId
      ? input.allowUnreservedPayment ? { _id: productId, deletedAt: null } : { _id: productId }
      : { _id: productId, status: ProductStatus.ACTIVE, deletedAt: null }).session(session);
    if (!product) throw new Error('Product is not available for sale');
    if (!paymentRequestId && product.price !== input.expectedUnitPrice) throw new Error('Product price changed; confirm the current price');
    const unitPrice = paymentRequestId ? input.expectedUnitPrice : product.price;
    const subtotal = unitPrice * input.quantity;
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0) throw new Error('Invalid checkout total');
    const couponCode = normalizeCouponCode(input.couponCode);
    if (couponCode && input.expectedTotalAmount === undefined) throw new CouponUnavailableError('Vui lòng xác nhận tổng tiền sau giảm giá');
    const pricing = couponCode && this.coupons ? await this.coupons.redeem({ userId, productId, subtotal, couponCode,
      quantity: input.quantity, checkoutKey: input.idempotencyPrefix, expectedTotalAmount: input.expectedTotalAmount }, session)
      : await this.couponPricing(input, subtotal, session);
    const total = pricing.totalAmount;
    if (user.walletBalance < total) throw new InsufficientBalanceError();
    // A legacy paid checkout consumes its earlier hold. A soft checkout
    // rechecks eligibility and reserves available rows only after payment.
    if ((!paymentRequestId || input.allowUnreservedPayment) && product.purchaseLimitPerUser > 0) {
      await this.inventory.releaseExpiredPaymentReservationsForProduct(productId, session);
      const held = await this.inventory.countActivePaymentReservations(productId, userId, session);
      const purchased = await this.orderModel.countDocuments({ userId, productId,
        status: { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } }).session(session);
      if (purchased + held + input.quantity > product.purchaseLimitPerUser) throw new Error('Purchase limit reached');
    }

    const heldItems = paymentRequestId && !input.allowUnreservedPayment
      ? await this.inventory.findPaymentReservations(paymentRequestId, session)
      : undefined;
    if (heldItems && heldItems.length !== input.quantity) throw new OutOfStockError();
    if (heldItems?.some((item) => !item.productId.equals(productId) || !item.reservedByUserId?.equals(userId))) {
      throw new IdempotencyConflictError();
    }

    const created: BatchOrder[] = [];
    let balanceBefore = user.walletBalance;
    for (let index = 0; index < input.quantity; index++) {
      const discountAmount = Math.floor(pricing.discountAmount / input.quantity) + (index < pricing.discountAmount % input.quantity ? 1 : 0);
      const totalAmount = unitPrice - discountAmount;
      const metadata = { source: paymentRequestId ? 'bank-quick-checkout' : 'wallet-batch',
        paymentRequestId: input.paymentRequestId, purchaseGroupId: input.idempotencyPrefix,
        batchQuantity: input.quantity, batchTotalAmount: total };
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
        quantity: 1, unitPrice, grossAmount: unitPrice, discountAmount, totalAmount,
        couponCode: pricing.couponCode, couponId: pricing.couponId,
        status: OrderStatus.PENDING_DELIVERY, paymentMethod: PaymentMethod.WALLET,
        deliveryStatus: 'PENDING', idempotencyKey: keys[index],
        metadata,
      } as Partial<Order>, session) as BatchOrder;
      const debited = await this.users.debit(userId, totalAmount, session);
      if (!debited) throw new InsufficientBalanceError();
      if (totalAmount > 0) {
        const walletTransaction = await this.walletTransactions.create({
          userId, balanceBefore, balanceAfter: debited.walletBalance, amount: -totalAmount,
          type: WalletTransactionType.PURCHASE, reason: `Purchase ${order.orderCode}`,
          referenceType: WalletReferenceType.ORDER, referenceId: order._id,
          idempotencyKey: `purchase:${keys[index]}`, actorType: ActorType.USER, actorId: userId,
          metadata,
        }, session);
        await this.orders.attachWalletTransaction(order._id, walletTransaction._id, session);
        order.walletTransactionId = walletTransaction._id;
      }
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
    if (input.expectedTotalAmount !== undefined && (!Number.isSafeInteger(input.expectedTotalAmount) || input.expectedTotalAmount < 0)) throw new Error('Invalid checkout total');
    if (input.couponCode !== undefined && (!normalizeCouponCode(input.couponCode) || !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(normalizeCouponCode(input.couponCode)!))) {
      throw new CouponUnavailableError('Mã giảm giá không hợp lệ');
    }
  }

  private async couponPricing(input: Pick<PurchaseBatchInput, 'userId' | 'productId' | 'couponCode' | 'expectedTotalAmount'>,
    subtotal: number, session?: ClientSession): Promise<CouponPricing> {
    const couponCode = normalizeCouponCode(input.couponCode);
    if (couponCode && !this.coupons) throw new CouponUnavailableError('Dịch vụ mã giảm giá chưa sẵn sàng');
    const pricing = couponCode ? await this.coupons!.price({ userId: new Types.ObjectId(input.userId),
      productId: new Types.ObjectId(input.productId), couponCode, subtotal }, session)
      : { subtotal, discountAmount: 0, totalAmount: subtotal };
    if (input.expectedTotalAmount !== undefined && input.expectedTotalAmount !== pricing.totalAmount) {
      throw new CouponUnavailableError('Tổng thanh toán đã thay đổi; vui lòng xác nhận lại');
    }
    return pricing;
  }

  private batchKeys(input: PurchaseBatchInput) {
    return Array.from({ length: input.quantity }, (_, index) => `${input.idempotencyPrefix}:${index}`);
  }

  private async findBatch(keys: string[], session?: ClientSession): Promise<BatchOrder[]> {
    return await this.orderModel.find({ idempotencyKey: { $in: keys } }).session(session ?? null).exec() as BatchOrder[];
  }

  private assertCompleteBatch(found: BatchOrder[], input: PurchaseBatchInput, keys: string[]) {
    if (found.length !== input.quantity) throw new IdempotencyConflictError();
    if (input.expectedTotalAmount !== undefined && found.reduce((sum, order) => sum + order.totalAmount, 0) !== input.expectedTotalAmount) throw new IdempotencyConflictError();
    const byKey = new Map(found.map((order) => [order.idempotencyKey, order]));
    return keys.map((key) => {
      const order = byKey.get(key);
      if (!order || order.userId.toString() !== input.userId || order.productId.toString() !== input.productId ||
        order.unitPrice !== input.expectedUnitPrice || order.couponCode !== normalizeCouponCode(input.couponCode) ||
        (order.metadata?.batchQuantity !== undefined && order.metadata.batchQuantity !== input.quantity) ||
        order.metadata?.paymentRequestId !== input.paymentRequestId) throw new IdempotencyConflictError();
      return order;
    });
  }

  private async enqueueBatch(orders: Array<{ _id: Types.ObjectId }>) {
    if (!orders.length) return;
    const stored = await this.orderModel.find({ _id: { $in: orders.map((order) => order._id) } })
      .select('_id userId productId metadata.paymentRequestId').sort({ createdAt: 1, _id: 1 }).lean();
    const first = stored[0];
    const paymentRequestId = first?.metadata?.paymentRequestId;
    const sameQuickCheckout = first !== undefined && typeof paymentRequestId === 'string'
      && Types.ObjectId.isValid(paymentRequestId) && stored.length === orders.length
      && stored.every((order) => order.userId.equals(first.userId) && order.productId.equals(first.productId)
        && order.metadata?.paymentRequestId === paymentRequestId);
    const queueOrders = sameQuickCheckout ? [first] : orders;
    for (const order of queueOrders) {
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

  private async enqueueBatchPurchaseAlert(orders: Array<{ _id: Types.ObjectId }>) {
    if (!orders.length || !this.purchaseAlerts) return;
    const ids = orders.map((order) => order._id);
    const stored = await this.orderModel.find({ _id: { $in: ids } })
      .select('_id userId productId metadata.paymentRequestId').sort({ createdAt: 1 }).lean();
    if (stored.length !== ids.length) return;
    const first = stored[0]!;
    if (stored.some((order) => !order.userId.equals(first.userId) || !order.productId.equals(first.productId))) return;
    const paymentRequestId = stored.map((order) => order.metadata?.paymentRequestId)
      .find((value): value is string => typeof value === 'string' && Types.ObjectId.isValid(value));
    await this.enqueuePurchaseAlert(paymentRequestId ? new Types.ObjectId(paymentRequestId) : first._id,
      first.userId, first.productId, stored.length);
  }

  private async enqueuePurchaseAlert(groupId: Types.ObjectId, buyerId: Types.ObjectId,
    productId: Types.ObjectId, quantity: number) {
    if (!this.purchaseAlerts) return;
    try {
      await this.purchaseAlerts.enqueue({ purchaseGroupId: groupId.toString(), buyerId: buyerId.toString(),
        productId: productId.toString(), quantity });
    } catch (error) {
      // The order is already committed. A social-proof notification must never
      // make the buyer see a false purchase failure.
      console.error({ event: 'purchase-social-proof-queue-failed', purchaseGroupId: groupId.toString(),
        message: error instanceof Error ? error.message : 'unknown error' });
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
