import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { toast } from '../apps/admin-web/node_modules/sonner/dist/index.mjs';
import { adminToastKind, showAdminToast } from '../apps/admin-web/app/admin/admin-toast';

test('admin feedback uses the global Sonner viewport instead of an inline banner', async () => {
  const layout = await readFile(new URL('../apps/admin-web/app/layout.tsx', import.meta.url), 'utf8');
  const page = await readFile(new URL('../apps/admin-web/app/admin/page.tsx', import.meta.url), 'utf8');
  const toaster = await readFile(new URL('../apps/admin-web/app/app-toaster.tsx', import.meta.url), 'utf8');

  expect(layout).toContain('<AppToaster />');
  expect(toaster).toContain('position="top-center"');
  expect(toaster).toContain('closeButton');
  expect(page).not.toContain('<FlashMessage');
});

test('admin feedback keeps semantic toast colors', () => {
  expect(adminToastKind('Đã nhập 7 hàng mới.')).toBe('success');
  expect(adminToastKind('Đã nhập 7 hàng mới; bỏ qua 2 dòng trùng.')).toBe('success');
  expect(adminToastKind('Phát hiện 2 dòng trùng. Hãy chọn cách xử lý.')).toBe('warning');
  expect(adminToastKind('Không thể xóa hàng khỏi kho.')).toBe('error');
  expect(adminToastKind('Hãy chọn sản phẩm trước.')).toBe('warning');
  expect(adminToastKind('Đang đồng bộ dữ liệu.')).toBe('info');
  expect(adminToastKind('API không thể hoạt động.')).toBe('error');
  expect(adminToastKind('Đã xảy ra lỗi khi lưu.')).toBe('error');
  expect(adminToastKind('Unauthorized')).toBe('error');
  expect(adminToastKind('Forbidden')).toBe('error');
});

test('admin feedback gets fresh IDs after replacement and clearing without dismissing unrelated toasts', () => {
  const frameProperties = ['requestAnimationFrame', 'cancelAnimationFrame'] as const;
  const originalFrames = frameProperties.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
  const unrelatedId = toast.info('Background notification');

  try {
    showAdminToast('  Đã lưu lần đầu.  ');
    const first = toast.getToasts().find((entry) => entry.id !== unrelatedId)!;
    expect(first).toMatchObject({ title: 'Đã lưu lần đầu.', type: 'success', duration: 6_000 });

    showAdminToast('Hãy chọn sản phẩm.');
    const replacement = toast.getToasts().find((entry) => entry.id !== unrelatedId)!;
    expect(replacement).toMatchObject({ title: 'Hãy chọn sản phẩm.', type: 'warning' });
    expect(replacement.id).not.toBe(first.id);
    expect(toast.getToasts().map((entry) => entry.id)).toEqual([unrelatedId, replacement.id]);

    showAdminToast('   ');
    expect(toast.getToasts().map((entry) => entry.id)).toEqual([unrelatedId]);
    showAdminToast('Đã nhập 7 hàng mới; bỏ qua 2 dòng trùng.');
    const latest = toast.getToasts().find((entry) => entry.id !== unrelatedId)!;
    expect(latest.id).not.toBe(replacement.id);
    expect(latest).toMatchObject({ title: 'Đã nhập 7 hàng mới; bỏ qua 2 dòng trùng.', type: 'success' });
    frames.forEach((callback) => callback(0));
    expect(toast.getToasts().map((entry) => entry.id)).toEqual([unrelatedId, latest.id]);

    showAdminToast('');
    showAdminToast('');
    expect(toast.getToasts().map((entry) => entry.id)).toEqual([unrelatedId]);
  } finally {
    showAdminToast('');
    toast.dismiss(unrelatedId);
    frames.forEach((callback) => callback(0));
    frameProperties.forEach((name, index) => {
      const descriptor = originalFrames[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
