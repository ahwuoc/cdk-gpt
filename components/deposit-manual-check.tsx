"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DepositManualCheck() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleCheck() {
    if (loading) return;
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/deposit/check", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json();

      if (payload.success && payload.credited) {
        setMessage({ type: "success", text: payload.message });
        router.refresh();
      } else if (payload.success) {
        setMessage({ type: "error", text: payload.message });
      } else {
        setMessage({ type: "error", text: payload.message || "Lỗi kiểm tra giao dịch" });
      }
    } catch {
      setMessage({ type: "error", text: "Lỗi kết nối, vui lòng thử lại" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full flex flex-col gap-2">
      <button
        type="button"
        onClick={handleCheck}
        disabled={loading}
        className="h-14 w-full rounded-2xl bg-primary text-primary-foreground font-extrabold text-base md:text-lg hover:bg-primary/95 shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2.5 hover:scale-[1.01] active:scale-[0.99] font-sans cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Đang kiểm tra..." : "Kiểm tra giao dịch ngay"}
      </button>
      {message && (
        <p className={`text-sm font-semibold text-center px-2 ${message.type === "success" ? "text-emerald-600" : "text-red-500"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
