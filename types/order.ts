export type OrderStatus = "pending" | "assigned" | "completed" | "cancelled" | "refunded";

export type OrderDocument = {
  id: string;
  buyerUsername?: string;
  buyerContact: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  status: OrderStatus;
  accountId?: string;
  accountEmail?: string;
  accounts?: { id: string; email: string }[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  assignedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
};

export type OrderView = {
  id: string;
  buyerUsername: string | null;
  buyerContact: string;
  unitPriceLabel: string;
  quantity: number;
  totalPrice: number;
  totalPriceLabel: string;
  status: OrderStatus;
  accountEmail: string | null;
  accountId: string | null;
  accounts: { id: string; email: string }[];
  createdAt: string;
  assignedAt: string | null;
};
