'use client';

import { Toaster } from 'sonner';

export function AppToaster() {
  return <Toaster theme="dark" position="top-center" richColors closeButton
    duration={6_000} offset={20} mobileOffset={16}
    containerAriaLabel="Thông báo" toastOptions={{ closeButtonAriaLabel: 'Đóng thông báo' }} />;
}
