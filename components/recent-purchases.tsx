"use client";

import { useEffect, useState } from "react";
import type { RecentPurchase } from "@/lib/orders";
import { Sparkles, ShoppingBag, CheckCircle2 } from "lucide-react";

type RecentPurchasesProps = {
  initialPurchases: RecentPurchase[];
  unitPrice: number;
};

const MOCK_NAMES = [
  "nguyenan", "minhthao", "trantung", "linhdan", "quanghuy",
  "thanhmai", "hoangviet", "khanhlinh", "ducmanh", "quynhnhu",
  "baolong", "thuytrang", "huukhang", "diemmy", "tiendat",
  "xuanbach", "phuongnam", "haivan", "tiendung", "kimoanh"
];

function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")}đ`;
}

function getAvatarGradient(username: string | null) {
  const name = username || "Anonymous";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "from-pink-500 to-rose-500",
    "from-purple-500 to-indigo-500",
    "from-blue-500 to-cyan-500",
    "from-teal-500 to-emerald-500",
    "from-amber-500 to-orange-500",
    "from-fuchsia-500 to-purple-600",
    "from-sky-400 to-indigo-500",
    "from-emerald-400 to-teal-600"
  ];
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

function maskUsername(username: string | null) {
  if (!username) return "Khách ẩn danh";
  const name = username.split("@")[0];
  if (name.length <= 3) {
    return `${name}***`;
  }
  return `${name.slice(0, 3)}***${name.slice(-2)}`;
}

export function RecentPurchases({ initialPurchases, unitPrice }: RecentPurchasesProps) {
  const [purchases, setPurchases] = useState<RecentPurchase[]>([]);
  const [toastPurchase, setToastPurchase] = useState<RecentPurchase | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [ticker, setTicker] = useState(0);

  // Parse dates and fill in simulated purchases if real orders are low
  useEffect(() => {
    // 1. Process real purchases
    const processedReal = initialPurchases.map(p => ({
      ...p,
      createdAt: new Date(p.createdAt)
    }));

    // 2. Generate simulated purchases if fewer than 6 real ones exist
    const finalPurchases = [...processedReal];
    if (finalPurchases.length < 8) {
      const needed = 8 - finalPurchases.length;
      for (let i = 0; i < needed; i++) {
        const name = MOCK_NAMES[Math.floor(Math.random() * MOCK_NAMES.length)] + (Math.floor(Math.random() * 89 + 10));
        const maskedName = maskUsername(name);
        
        // Distribute timestamps back in time
        const baseMin = (i + 1) * 4 + (processedReal.length * 6);
        const minutesAgo = baseMin + Math.floor(Math.random() * 6);
        const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);
        
        const quantity = Math.random() > 0.85 ? 2 : 1;
        const totalPrice = quantity * (unitPrice || 150000);

        finalPurchases.push({
          id: `simulated-${i}-${createdAt.getTime()}`,
          buyerUsername: maskedName,
          quantity,
          totalPrice,
          status: "completed",
          createdAt
        });
      }
    }

    // Sort by date descending
    finalPurchases.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    setPurchases(finalPurchases);
  }, [initialPurchases, unitPrice]);

  // Dynamic time tick
  useEffect(() => {
    const timer = setInterval(() => {
      setTicker(prev => prev + 1);
    }, 60000); // refresh every minute to update relative times
    return () => clearInterval(timer);
  }, []);

  // Floating Toast cycle
  useEffect(() => {
    if (purchases.length === 0) return;

    // Wait 4 seconds after mount to show the first toast
    const initialDelay = setTimeout(() => {
      cycleToast(0);
    }, 4000);

    let intervalId: NodeJS.Timeout;

    const cycleToast = (currentIndex: number) => {
      if (purchases.length === 0) return;
      
      const purchase = purchases[currentIndex % purchases.length];
      setToastPurchase(purchase);
      setShowToast(true);

      // Hide toast after 4.5 seconds
      const hideTimeout = setTimeout(() => {
        setShowToast(false);
      }, 4500);

      // Schedule next toast in 12 seconds
      intervalId = setTimeout(() => {
        cycleToast(currentIndex + 1);
      }, 12000);

      return () => {
        clearTimeout(hideTimeout);
      };
    };

    return () => {
      clearTimeout(initialDelay);
      if (intervalId) clearTimeout(intervalId);
    };
  }, [purchases]);

  const getRelativeTimeText = (date: Date) => {
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Vừa xong";
    if (diffMins < 60) return `${diffMins} phút trước`;
    if (diffHours < 24) return `${diffHours} giờ trước`;
    return `${diffDays} ngày trước`;
  };

  return (
    <>
      {/* Sidebar Panel */}
      <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm space-y-4 transition-all duration-300 hover:shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-rose-50 p-2 text-rose-500">
              <ShoppingBag className="h-4 w-4" />
            </div>
            <h3 className="font-black text-gray-950 text-base">Giao dịch gần đây</h3>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">Live</span>
          </div>
        </div>

        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-100">
          {purchases.map((purchase, index) => {
            const masked = purchase.buyerUsername && purchase.buyerUsername.includes("***") 
              ? purchase.buyerUsername 
              : maskUsername(purchase.buyerUsername);
            const avatarChar = (purchase.buyerUsername || "K").charAt(0).toUpperCase();
            const gradient = getAvatarGradient(purchase.buyerUsername);

            return (
              <div 
                key={purchase.id} 
                className="group flex items-start gap-3 rounded-2xl border border-transparent bg-gray-50/50 p-3 transition-all duration-300 hover:border-gray-100 hover:bg-white hover:shadow-sm"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} font-bold text-white text-sm shadow-sm transition-transform duration-300 group-hover:scale-105`}>
                  {avatarChar}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-bold text-gray-950">{masked}</span>
                    <span className="shrink-0 text-[10px] font-semibold text-gray-400">
                      {getRelativeTimeText(purchase.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-gray-500">
                      Mua <span className="font-extrabold text-gray-800">{purchase.quantity}x</span> ChatGPT Plus
                    </span>
                    <span className="font-extrabold text-emerald-600">
                      {formatPrice(purchase.totalPrice)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Toast Notification */}
      {toastPurchase && (
        <div 
          className={`fixed bottom-6 left-6 z-50 flex max-w-sm items-center gap-3.5 rounded-2xl border border-gray-100/80 bg-white/95 p-4 shadow-xl shadow-gray-150/40 backdrop-blur-md transition-all duration-500 ${
            showToast 
              ? "translate-y-0 opacity-100 pointer-events-auto scale-100" 
              : "translate-y-10 opacity-0 pointer-events-none scale-95"
          }`}
        >
          <div className="relative shrink-0">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${getAvatarGradient(toastPurchase.buyerUsername)} font-bold text-white shadow-md shadow-gray-200`}>
              {(toastPurchase.buyerUsername || "K").charAt(0).toUpperCase()}
            </div>
            <div className="absolute -bottom-1.5 -right-1.5 rounded-full bg-white p-0.5 shadow-sm">
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 fill-emerald-50" />
            </div>
          </div>
          
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600">
                <Sparkles className="h-2.5 w-2.5 animate-pulse" />
                Vừa thanh toán
              </span>
              <span className="text-[10px] font-semibold text-gray-400">
                {getRelativeTimeText(toastPurchase.createdAt)}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-gray-600">
              <span className="font-extrabold text-gray-900">
                {toastPurchase.buyerUsername && toastPurchase.buyerUsername.includes("***") 
                  ? toastPurchase.buyerUsername 
                  : maskUsername(toastPurchase.buyerUsername)}
              </span>{" "}
              đã mua <span className="font-extrabold text-gray-800">{toastPurchase.quantity}x</span> tài khoản ChatGPT Plus.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
