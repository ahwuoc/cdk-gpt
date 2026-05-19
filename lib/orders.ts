import { ObjectId, type WithId } from "mongodb";
import type { OrderDocument, OrderStatus, OrderView } from "@/types/order";
import { getDatabase } from "./mongodb";

import { getShopPrice } from "./settings";

const collectionName = "orders";

function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")} VND`;
}

function mapOrder(document: WithId<OrderDocument>): OrderView {
  return {
    id: document._id.toHexString(),
    buyerUsername: document.buyerUsername ?? null,
    buyerContact: document.buyerContact,
    unitPriceLabel: formatPrice(document.unitPrice),
    quantity: document.quantity,
    totalPrice: document.totalPrice,
    totalPriceLabel: formatPrice(document.totalPrice),
    status: document.status,
    accountEmail: document.accountEmail ?? null,
    accountId: document.accountId ?? null,
    accounts: document.accounts ?? [],
    createdAt: document.createdAt.toLocaleString("vi-VN"),
    assignedAt: document.assignedAt
      ? document.assignedAt.toLocaleString("vi-VN")
      : null,
  };
}

async function getOrdersCollection() {
  const database = await getDatabase();
  return database.collection<OrderDocument>(collectionName);
}

export async function createOrder(input: {
  buyerUsername: string;
  buyerContact: string;
  quantity?: number;
  unitPrice?: number;
}) {
  const collection = await getOrdersCollection();
  const now = new Date();
  const quantity = input.quantity ?? 1;

  let resolvedPrice = input.unitPrice;
  if (resolvedPrice === undefined) {
    resolvedPrice = await getShopPrice();
  }
  const totalPrice = resolvedPrice * quantity;

  const result = await collection.insertOne({
    buyerUsername: input.buyerUsername,
    buyerContact: input.buyerContact.trim(),
    unitPrice: resolvedPrice,
    quantity,
    totalPrice,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  return result.insertedId.toHexString();
}

export async function listOrders() {
  const collection = await getOrdersCollection();
  const orders = await collection.find({}).sort({ createdAt: -1 }).toArray();
  return orders.map(mapOrder);
}

export async function listOrdersByUsername(username: string) {
  const collection = await getOrdersCollection();
  const orders = await collection
    .find({ buyerUsername: username })
    .sort({ createdAt: -1 })
    .toArray();
  return orders.map(mapOrder);
}

export async function getOrderById(id: string) {
  const collection = await getOrdersCollection();
  return collection.findOne({ _id: new ObjectId(id) });
}

export async function assignOrderAccounts(
  orderId: string,
  accounts: { id: string; email: string }[],
) {
  const collection = await getOrdersCollection();
  const now = new Date();
  const result = await collection.updateOne(
    {
      _id: new ObjectId(orderId),
      status: "pending",
    },
    {
      $set: {
        status: "assigned",
        accounts,
        accountId: accounts[0]?.id,
        accountEmail: accounts[0]?.email,
        assignedAt: now,
        updatedAt: now,
      },
    },
  );

  return result.modifiedCount === 1;
}

export async function cancelOrder(orderId: string) {
  const collection = await getOrdersCollection();
  const now = new Date();
  const result = await collection.updateOne(
    {
      _id: new ObjectId(orderId),
      status: { $in: ["pending", "assigned"] },
    },
    {
      $set: {
        status: "cancelled",
        cancelledAt: now,
        updatedAt: now,
      },
    },
  );

  return result.modifiedCount === 1;
}

export async function completeOrder(orderId: string) {
  const collection = await getOrdersCollection();
  const now = new Date();
  const result = await collection.updateOne(
    {
      _id: new ObjectId(orderId),
      status: "assigned",
      accountId: { $exists: true },
    },
    {
      $set: {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      },
    },
  );

  return result.modifiedCount === 1;
}

export async function countOrdersByStatus(status: OrderStatus) {
  const collection = await getOrdersCollection();
  return collection.countDocuments({ status });
}

export async function refundOrder(orderId: string) {
  const collection = await getOrdersCollection();
  const now = new Date();
  const result = await collection.updateOne(
    { _id: new ObjectId(orderId) },
    {
      $set: {
        status: "refunded",
        updatedAt: now,
      },
      $unset: {
        accountId: "",
        accountEmail: "",
        accounts: "",
        assignedAt: "",
        completedAt: "",
      },
    },
  );

  return result.modifiedCount === 1;
}
