"use client";

import { useState } from "react";
import { Copy, Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface CopyableFieldProps {
  label: string;
  value: string;
  displayValue?: string;
  isMonospace?: boolean;
  className?: string;
}

export function CopyableField({
  label,
  value,
  displayValue,
  isMonospace = false,
  className = "",
}: CopyableFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`Đã sao chép ${label.toLowerCase()}`);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Không thể sao chép");
    }
  };

  return (
    <div
      onClick={handleCopy}
      className={`group relative flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-4 transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 cursor-pointer select-none ${className}`}
    >
      <div className="flex-1 min-w-0">
        <span className="text-xs font-bold uppercase tracking-widest text-stone-400/90 block mb-1">
          {label}
        </span>
        <span
          className={`block whitespace-normal break-words text-stone-900 font-extrabold leading-snug ${isMonospace ? "font-mono text-lg tracking-wider" : "text-base md:text-lg"
            }`}
        >
          {displayValue || value}
        </span>
      </div>
      <button
        type="button"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-400 transition-all duration-200 group-hover:border-primary/30 group-hover:text-primary shadow-sm hover:scale-105 active:scale-95"
        aria-label={`Sao chép ${label}`}
      >
        {copied ? (
          <Check className="h-5 w-5 text-emerald-600 animate-in zoom-in-50 duration-200" />
        ) : (
          <Copy className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" />
        )}
      </button>
    </div>
  );
}

export function CopyableContentBox({ depositCode }: { depositCode: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(depositCode);
      setCopied(true);
      toast.success("Đã sao chép nội dung chuyển khoản!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Không thể sao chép");
    }
  };

  return (
    <div
      onClick={handleCopy}
      className="group relative cursor-pointer select-none rounded-2xl border border-amber-200 bg-amber-50/50 p-5 transition-all duration-200 hover:border-amber-400 hover:bg-amber-50/80 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs md:text-sm font-extrabold uppercase tracking-widest text-amber-800">
          <ShieldCheck className="h-5 w-5 text-amber-600 animate-pulse" />
          Nội dung chuyển khoản
        </div>
        <span className="hidden text-xs font-semibold text-amber-700 transition-opacity duration-200 sm:inline">
          {copied ? "Đã sao chép!" : "Click để sao chép"}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-4 border border-amber-100 shadow-md">
        <span className="min-w-0 select-all break-all font-mono text-xl font-black tracking-wider text-amber-950 md:text-2xl">
          {depositCode}
        </span>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-100 group-hover:text-amber-800 border border-amber-100 shadow-sm">
          {copied ? (
            <Check className="h-5 w-5 text-emerald-600 animate-in zoom-in-50 duration-200" />
          ) : (
            <Copy className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" />
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-amber-800/90 leading-relaxed font-sans font-medium">
        * Bắt buộc ghi chính xác 100% nội dung trên để hệ thống tự động cộng tiền trong 1 phút.
      </p>
    </div>
  );
}
