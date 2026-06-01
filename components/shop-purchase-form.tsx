"use client";

import { useState } from "react";
import { createOrderAction } from "@/app/actions";
import { SubmitButton } from "@/app/submit-button";

type ShopPurchaseFormProps = {
  isLoggedIn: boolean;
  sellableCount: number;
  currentBalance: number;
  unitPrice: number;
};

function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")}đ`;
}

export function ShopPurchaseForm({
  isLoggedIn,
  sellableCount,
  currentBalance,
  unitPrice,
}: ShopPurchaseFormProps) {
  const [quantity, setQuantity] = useState(1);

  const normalizedQuantity = Math.min(Math.max(quantity, 1), Math.max(sellableCount, 1));
  const totalPrice = normalizedQuantity * unitPrice;
  const maxAffordableQuantity =
    unitPrice > 0 ? Math.floor(currentBalance / unitPrice) : 0;
  const canAffordSelection = currentBalance >= totalPrice;
  const canBuy = isLoggedIn && sellableCount > 0 && canAffordSelection;

  return (
    <form action={createOrderAction} className="space-y-4">
      {isLoggedIn && sellableCount > 0 && (
        <div className="space-y-4 rounded-2xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="quantity" className="text-sm font-bold text-gray-700">
              Số lượng
            </label>
            <input
              id="quantity"
              type="number"
              name="quantity"
              value={normalizedQuantity}
              min="1"
              max={sellableCount}
              onChange={(event) => {
                const nextValue = Number.parseInt(event.target.value, 10);
                setQuantity(Number.isNaN(nextValue) ? 1 : nextValue);
              }}
              className="h-11 w-24 rounded-xl border border-gray-200 bg-white px-3 text-center font-bold text-gray-900 outline-none transition-all focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm">
            <span className="font-medium text-gray-500">Tổng thanh toán</span>
            <span className="text-lg font-black text-gray-900">{formatPrice(totalPrice)}</span>
          </div>
          <p className="text-xs text-gray-400">Tối đa {sellableCount} tài khoản còn hàng.</p>

          {!canAffordSelection && (
            <p className="text-sm text-red-500">
              Số dư hiện tại chỉ đủ mua tối đa {Math.max(maxAffordableQuantity, 0)} tài khoản.
            </p>
          )}
        </div>
      )}

      {isLoggedIn ? (
        sellableCount > 0 && canBuy ? (
          <SubmitButton className="h-14 w-full rounded-2xl bg-gray-900 font-bold text-white shadow-xl shadow-gray-200 transition-all hover:bg-gray-800 active:scale-[0.98]">
            Xác nhận thanh toán
          </SubmitButton>
        ) : (
          <button
            type="button"
            disabled
            className="h-14 w-full cursor-not-allowed rounded-2xl bg-gray-100 font-bold text-gray-400"
          >
            {sellableCount <= 0 ? "Tạm hết hàng" : "Số dư không đủ"}
          </button>
        )
      ) : null}
    </form>
  );
}
