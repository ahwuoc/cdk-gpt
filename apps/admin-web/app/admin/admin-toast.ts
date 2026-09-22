'use client';

import { toast } from 'sonner';

export type AdminToastKind = 'success' | 'error' | 'warning' | 'info';
let feedbackId: string | number | undefined;

export function adminToastKind(message: string): AdminToastKind {
  if (/không thể|không hợp lệ|thất bại|lỗi|\bfailed\b|\binvalid\b|\bunauthorized\b|\bforbidden\b|access denied|session expired/iu.test(message)) return 'error';
  if (/^(?:đã|✅|thành công)|hoạt động/iu.test(message)) return 'success';
  if (/^(?:hãy|chưa|phát hiện)|cảnh báo|trùng/iu.test(message)) return 'warning';
  return 'info';
}

export function showAdminToast(message: string, kind?: AdminToastKind): void {
  const text = message.trim();
  if (feedbackId !== undefined) {
    toast.dismiss(feedbackId);
    feedbackId = undefined;
  }
  if (!text) return;
  // A fresh ID keeps the previous toast's exit animation from removing this one.
  feedbackId = toast[kind ?? adminToastKind(text)](text, { duration: 6_000 });
}
