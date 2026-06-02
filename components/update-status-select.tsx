"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { updateAccountStatusAction } from "@/app/actions";
import { TrendingUp, AlertCircle, Check, X } from "lucide-react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { AccountStatus } from "@/types/account";

interface UpdateStatusSelectProps {
  id: string;
  currentStatus: AccountStatus;
  email: string;
}

export function UpdateStatusSelect({ id, currentStatus, email }: UpdateStatusSelectProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<AccountStatus>(currentStatus);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setPendingStatus(currentStatus);
  }, [currentStatus]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value as AccountStatus;
    if (newStatus !== currentStatus) {
      setPendingStatus(newStatus);
      setIsOpen(true);
    }
  };

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("id", id);
      formData.append("status", pendingStatus);
      const result = await updateAccountStatusAction(formData);
      if (result?.success) {
        toast.success(result.message);
        router.refresh();
      }
      setIsOpen(false);
    } catch (error) {
      console.error("Update failed", error);
      alert("Cập nhật thất bại, vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    setPendingStatus(currentStatus);
  };

  const statusConfig = {
    "not-registered": {
      label: "Chưa reg",
      color: "border-blue-200 bg-blue-50 text-blue-700",
    },
    "reg-success": {
      label: "Thành công",
      color: "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    "reg-failed": {
      label: "Thất bại",
      color: "border-red-200 bg-red-50 text-red-700",
    },
  };

  const modal = isOpen ? createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleCancel} />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-500 shadow-inner">
            <AlertCircle className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-900">Xác nhận cập nhật?</h3>
            <p className="text-sm text-slate-500">
              Bạn có chắc chắn muốn đổi trạng thái của <span className="font-bold text-slate-700">{email}</span> thành <span className={`font-bold ${statusConfig[pendingStatus].color} px-1.5 py-0.5 rounded`}>{statusConfig[pendingStatus].label}</span>?
            </p>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={handleCancel}
            disabled={isLoading}
            className="flex-1 h-12 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-50"
          >
            Hủy bỏ
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className="flex-1 h-12 rounded-xl bg-slate-900 text-sm font-bold text-white shadow-lg shadow-slate-200 transition-all hover:bg-slate-800 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Check className="h-4 w-4" />
                Xác nhận lưu
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="relative flex items-center gap-1.5">
      <div className="relative group">
        <select
          value={pendingStatus}
          onChange={handleChange}
          disabled={isLoading}
          className={`h-9 min-w-[120px] appearance-none rounded-lg border px-3 text-xs font-bold outline-none transition-all pr-8 cursor-pointer ${statusConfig[pendingStatus].color} hover:ring-2 hover:ring-slate-100`}
        >
          <option value="not-registered">Chưa reg</option>
          <option value="reg-success">Thành công</option>
          <option value="reg-failed">Thất bại</option>
        </select>
        <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
          <TrendingUp className="h-3 w-3 opacity-50" />
        </div>
      </div>
      {modal}
    </div>
  );
}
