"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type CheckResponse = {
  success: boolean;
  credited?: boolean;
  amount?: number;
  balanceAfter?: number;
  message: string;
};

function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")}đ`;
}

export function DepositAutoCheck() {
  const router = useRouter();
  const [credited, setCredited] = useState<CheckResponse | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (acknowledged) return;

    let stopped = false;
    const intervalMs = Number.parseInt(
      process.env.NEXT_PUBLIC_DEPOSIT_CHECK_INTERVAL_MS || "3000",
      10,
    );
    const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 3000;

    async function checkDeposit() {
      if (stopped || inFlight.current || credited) return;
      inFlight.current = true;

      try {
        const response = await fetch("/api/deposit/check", {
          method: "POST",
          cache: "no-store",
        });
        const payload = (await response.json()) as CheckResponse;
        if (!stopped && payload.success && payload.credited) {
          setCredited(payload);
        }
      } catch (error) {
        console.error("Auto deposit check failed:", error);
      } finally {
        inFlight.current = false;
      }
    }

    void checkDeposit();

    const interval = window.setInterval(() => {
      void checkDeposit();
    }, safeIntervalMs);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [acknowledged, credited]);

  if (!credited) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl font-black text-emerald-700">
          +
        </div>
        <h2 className="mt-4 text-xl font-black text-slate-900">Đã cộng tiền</h2>
        <p className="mt-2 text-sm text-slate-500">{credited.message}</p>
        {typeof credited.balanceAfter === "number" && (
          <div className="mt-4 rounded-2xl bg-emerald-50 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Số dư mới</div>
            <div className="mt-1 text-2xl font-black text-emerald-800">{formatPrice(credited.balanceAfter)}</div>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setAcknowledged(true);
            setCredited(null);
            router.refresh();
          }}
          className="mt-5 h-11 w-full rounded-2xl bg-slate-900 text-sm font-bold text-white transition hover:bg-slate-800"
        >
          OK
        </button>
      </div>
    </div>
  );
}
