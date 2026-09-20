'use client';

import { type FormEvent, useEffect, useId, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Info, LoaderCircle, Repeat2 } from 'lucide-react';
import type { AuthorizedRequest } from './operations-dashboard';

interface ProductChoice { productId: string; name: string; }
interface RepeatCustomer {
  userId: string; telegramId: string | null; username: string | null; displayName: string | null;
  productId: string; productName: string; purchaseCount: number; quantity: number; totalSpent: number;
  purchaseDays: string[]; longestStreak: number; streakFrom: string; streakTo: string; lastPurchaseAt: string;
}
interface RepeatReport {
  range: { from: string; to: string; days: number }; timezone: string; days: number; maxDays: number | null;
  summary: { buyers: number; repeatBuyers: number; repeatRate: number | null };
  products: ProductChoice[]; items: RepeatCustomer[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
interface ReportState { key: string; loading: boolean; error: string; data: RepeatReport | null; }
const integer = (value: number) => value.toLocaleString('vi-VN');
const money = (value: number) => `${Math.round(value).toLocaleString('vi-VN')} ₫`;
const dateOnly = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;

export function ProductRepeatPurchases({ authorized, from, to, refreshVersion }: {
  authorized: AuthorizedRequest; from: string; to: string; refreshVersion: number;
}) {
  const productSelectId = useId();
  const [days, setDays] = useState(2);
  const [maxDays, setMaxDays] = useState<number | null>(null);
  const [draftDays, setDraftDays] = useState('2');
  const [draftMaxDays, setDraftMaxDays] = useState('');
  const [daysError, setDaysError] = useState('');
  const dayDescription = maxDays === null ? `ít nhất ${days} ngày liên tiếp`
    : days === maxDays ? `đúng ${days} ngày liên tiếp` : `từ ${days} đến ${maxDays} ngày liên tiếp`;
  const rangeKey = `${from}:${to}`;
  const [selection, setSelection] = useState({ rangeKey, productId: '', page: 1 });
  const productId = selection.rangeKey === rangeKey ? selection.productId : '';
  const page = selection.rangeKey === rangeKey ? selection.page : 1;
  const [retry, setRetry] = useState(0);
  const [choices, setChoices] = useState<{ rangeKey: string; products: ProductChoice[] }>({ rangeKey: '', products: [] });
  const [state, setState] = useState<ReportState>({ key: '', loading: true, error: '', data: null });
  const requestKey = `${rangeKey}:${days}:${maxDays ?? ''}:${productId}:${page}:${refreshVersion}:${retry}`;
  const loading = state.key !== requestKey || state.loading;
  const error = state.key === requestKey ? state.error : '';
  const data = state.key === requestKey && !loading && !error ? state.data : null;
  const products = choices.rangeKey === rangeKey ? choices.products : [];

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setSelection((current) => current.rangeKey === rangeKey ? current : { rangeKey, productId: '', page: 1 });
      setState({ key: requestKey, loading: true, error: '', data: null });
      try {
        const query = new URLSearchParams({ from, to, days: String(days), page: String(page), limit: '20' });
        if (maxDays !== null) query.set('maxDays', String(maxDays));
        if (productId) query.set('productId', productId);
        const response = await authorized(`/admin/analytics/product-repeat-purchases?${query}`, { signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = isRecord(body) ? body.message : null;
          throw new Error(typeof message === 'string' ? message : Array.isArray(message) && message.every((item) => typeof item === 'string') ? message.join('. ') : 'Không thể tải thống kê mua lại.');
        }
        if (!isRepeatReport(body) || body.days !== days || body.maxDays !== maxDays || body.range.from !== from || body.range.to !== to || body.pagination.page !== page) {
          throw new Error('Dữ liệu mua lại chưa đầy đủ. Vui lòng thử lại.');
        }
        if (!controller.signal.aborted) {
          setChoices({ rangeKey, products: body.products });
          if (page > Math.max(1, body.pagination.totalPages)) {
            setSelection({ rangeKey, productId, page: 1 });
            return;
          }
          setState({ key: requestKey, loading: false, error: '', data: body });
        }
      } catch (cause) {
        if (!controller.signal.aborted) setState({ key: requestKey, loading: false, error: cause instanceof Error ? cause.message : 'Không thể tải thống kê mua lại.', data: null });
      }
    });
    return () => controller.abort();
  }, [authorized, from, to, days, maxDays, productId, page, rangeKey, requestKey]);

  function applyDays(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const invalidNumber = ['days', 'maxDays'].some((name) => {
      const input = event.currentTarget.elements.namedItem(name);
      return input instanceof HTMLInputElement && input.validity.badInput;
    });
    const minimum = Number(fields.get('days'));
    const maximumText = String(fields.get('maxDays') ?? '').trim();
    const maximum = maximumText ? Number(maximumText) : null;
    if (invalidNumber || !isStreakDays(minimum) || (maximum !== null && !isStreakDays(maximum))) {
      setDaysError('Nhập số ngày nguyên từ 2 đến 366; có thể để trống số ngày tối đa.');
      return;
    }
    if (maximum !== null && maximum < minimum) {
      setDaysError('Số ngày tối đa phải lớn hơn hoặc bằng số ngày tối thiểu.');
      return;
    }
    setDaysError('');
    setDraftDays(String(minimum)); setDraftMaxDays(maximum === null ? '' : String(maximum));
    setDays(minimum); setMaxDays(maximum);
    setSelection({ rangeKey, productId, page: 1 });
  }

  return <section className="admin-card min-w-0 overflow-hidden" aria-label="Mua lại theo sản phẩm" aria-busy={loading}>
    <div className="border-b border-slate-800 p-5 sm:p-6">
      <div className="flex items-start gap-3"><Repeat2 size={20} className="mt-0.5 shrink-0 text-cyan-300" /><div className="min-w-0"><h2 className="font-semibold text-slate-100">Mua lại theo sản phẩm</h2><p className="mt-1 text-xs leading-5 text-slate-400">Lọc chuỗi mua dài nhất của mỗi khách với cùng sản phẩm: {dayDescription}.</p></div></div>
      <div className="mt-5 flex min-w-0 flex-wrap items-end gap-4">
        <label htmlFor={productSelectId} className="w-full min-w-0 basis-full sm:w-auto sm:flex-1 sm:basis-auto sm:max-w-sm"><span className="mb-2 block text-[11px] text-slate-400">Sản phẩm</span><select id={productSelectId} aria-label="Lọc sản phẩm mua lại" value={productId} onChange={(event) => setSelection({ rangeKey, productId: event.target.value, page: 1 })} className="input w-full min-w-0 text-xs"><option value="">Tất cả sản phẩm</option>{productId && !products.some((product) => product.productId === productId) && <option value={productId}>Sản phẩm đã chọn</option>}{products.map((product) => <option key={product.productId} value={product.productId}>{product.name || 'Sản phẩm đã xóa'}</option>)}</select></label>
        <form onSubmit={applyDays} noValidate className="flex w-full min-w-0 flex-wrap items-end gap-2 sm:w-auto" aria-label="Chọn khoảng ngày mua liên tiếp">
          <label className="min-w-0 flex-1 sm:w-36 sm:flex-none"><span className="mb-2 block text-[11px] text-slate-400">Từ (ngày liên tiếp)</span><input type="number" name="days" min="2" max="366" step="1" required value={draftDays} onChange={(event) => setDraftDays(event.target.value)} aria-label="Số ngày liên tiếp tối thiểu" aria-invalid={Boolean(daysError)} className="input w-full min-w-0 text-xs" /></label>
          <label className="min-w-0 flex-1 sm:w-36 sm:flex-none"><span className="mb-2 block text-[11px] text-slate-400">Đến (ngày liên tiếp)</span><input type="number" name="maxDays" min="2" max="366" step="1" value={draftMaxDays} onChange={(event) => setDraftMaxDays(event.target.value)} placeholder="Không giới hạn" aria-label="Số ngày liên tiếp tối đa" aria-invalid={Boolean(daysError)} className="input w-full min-w-0 text-xs" /></label>
          <button type="submit" className="button-secondary w-full text-xs sm:w-auto">Áp dụng số ngày</button>
        </form>
      </div>
      {daysError && <p role="alert" className="mt-3 text-xs text-rose-300">{daysError}</p>}
      <p className="mt-3 text-[11px] leading-5 text-slate-500">Nhập từ 2 đến 366 ngày. Để trống ô “Đến” nếu chỉ cần số ngày tối thiểu. Bộ lọc áp dụng cho chuỗi dài nhất của mỗi khách với từng sản phẩm.</p>
      <p className="mt-4 text-[11px] leading-5 text-slate-500">{dateOnly(from)} — {dateOnly(to)} · Theo ngày đặt mua, giờ Việt Nam · Chỉ tính đơn hiện đã giao thành công.</p>
    </div>

    {loading ? <div role="status" className="flex items-center justify-center gap-2 px-5 py-14 text-xs text-slate-400"><LoaderCircle size={16} className="animate-spin" />Đang tìm khách mua liên tiếp…</div> : error ? <div role="alert" className="px-5 py-10 text-center"><p className="text-sm text-slate-200">Chưa tải được thống kê mua lại</p><p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-rose-300">{error}</p><button type="button" className="button-secondary mt-4 text-xs" onClick={() => setRetry((current) => current + 1)}>Thử lại thống kê mua lại</button></div> : data && <>
      <div className="grid gap-4 border-b border-slate-800 p-5 sm:grid-cols-3 sm:p-6">
        <SummaryMetric label="Khách đã mua" value={integer(data.summary.buyers)} detail={productId ? 'Khách duy nhất mua sản phẩm đang chọn trong kỳ' : 'Khách duy nhất mua bất kỳ sản phẩm nào trong kỳ'} />
        <SummaryMetric label="Khách đạt khoảng ngày đã chọn" value={integer(data.summary.repeatBuyers)} detail={`Chuỗi dài nhất ${dayDescription}; mỗi khách chỉ đếm một lần`} />
        <SummaryMetric label="Tỷ lệ khách mua liên tiếp" value={data.summary.repeatRate == null ? '—' : `${data.summary.repeatRate.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`} detail={`${integer(data.summary.repeatBuyers)} / ${integer(data.summary.buyers)} khách đã mua trong phạm vi đang chọn${data.summary.buyers === 0 ? ' · Chưa có mẫu đo' : ''}`} />
      </div>
      {data.items.length === 0 ? <div className="px-5 py-12 text-center"><Repeat2 size={26} className="mx-auto text-slate-600" /><p className="mt-3 text-sm text-slate-300">{data.summary.buyers ? `Chưa có khách có chuỗi dài nhất ${dayDescription}` : 'Chưa có lượt mua thành công trong phạm vi này'}</p><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">Thử đổi khoảng số ngày liên tiếp, mở rộng kỳ báo cáo hoặc chọn sản phẩm khác. Các ngày trong chuỗi phải nằm trong kỳ báo cáo.</p></div> : <div className="relative max-h-[600px] overflow-x-auto"><table className="w-full min-w-[880px] text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-medium">Khách hàng</th><th className="px-5 py-3 font-medium">Sản phẩm</th><th className="px-5 py-3 font-medium">Chuỗi dài nhất</th><th className="px-5 py-3 text-right font-medium">Lượt mua trong kỳ</th><th className="px-5 py-3 text-right font-medium">Chi tiêu sản phẩm trong kỳ</th><th className="px-5 py-3"><span className="sr-only">Tất cả đơn của khách</span></th></tr></thead>
        <tbody className="divide-y divide-slate-800/70">{data.items.map((customer) => {
          const name = customer.displayName || (customer.username ? `@${customer.username}` : customer.telegramId ? `Khách ${customer.telegramId}` : 'Khách đã xóa');
          return <tr key={`${customer.userId}:${customer.productId}`} className="hover:bg-slate-800/20"><td className="max-w-[230px] px-5 py-4 align-top"><p className="truncate font-medium text-slate-200" title={name}>{name}</p><p className="mt-1 truncate font-mono text-[11px] text-slate-500">{customer.username && customer.displayName ? `@${customer.username} · ` : ''}{customer.telegramId || customer.userId}</p></td><td className="max-w-[230px] px-5 py-4 align-top"><p className="break-words text-xs leading-5 text-slate-300">{customer.productName || 'Sản phẩm đã xóa'}</p></td><td className="min-w-[230px] px-5 py-4 align-top"><span className="inline-flex rounded-md border border-cyan-300/20 bg-cyan-300/5 px-2 py-1 text-xs font-medium text-cyan-200">{integer(customer.longestStreak)} ngày liên tiếp</span><p className="mt-2 text-[11px] tabular-nums text-slate-400">{dateOnly(customer.streakFrom)} — {dateOnly(customer.streakTo)}</p><details className="mt-2 max-w-[240px]"><summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">Xem {integer(customer.purchaseDays.length)} ngày có mua trong kỳ</summary><p className="mt-2 max-h-28 overflow-y-auto text-[11px] leading-5 text-slate-400">{customer.purchaseDays.map(dateOnly).join(' · ')}</p></details></td><td className="px-5 py-4 text-right align-top tabular-nums"><p className="text-slate-300">{integer(customer.purchaseCount)}</p><p className="mt-1 text-[11px] text-slate-500">{integer(customer.quantity)} sản phẩm</p></td><td className="px-5 py-4 text-right align-top font-medium tabular-nums text-indigo-200">{money(customer.totalSpent)}</td><td className="px-5 py-4 align-top"><a href={`?view=orders&userId=${encodeURIComponent(customer.userId)}`} aria-label={`Xem tất cả đơn của ${name}`} title="Xem tất cả đơn của khách, gồm các sản phẩm khác" className="inline-flex rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-indigo-200"><ArrowUpRight size={16} /></a></td></tr>;
        })}</tbody>
      </table></div>}
      {data.pagination.total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-5 py-4"><p className="text-[11px] leading-5 text-slate-500">{integer(data.pagination.total)} cặp khách — sản phẩm · Một khách có thể xuất hiện ở nhiều sản phẩm.</p><div className="flex items-center gap-3"><button type="button" className="button-secondary !p-2" aria-label="Trang mua lại trước" disabled={page <= 1} onClick={() => setSelection({ rangeKey, productId, page: page - 1 })}><ChevronLeft size={15} /></button><span className="text-[11px] tabular-nums text-slate-400">Trang {page} / {Math.max(1, data.pagination.totalPages)}</span><button type="button" className="button-secondary !p-2" aria-label="Trang mua lại tiếp theo" disabled={page >= data.pagination.totalPages} onClick={() => setSelection({ rangeKey, productId, page: page + 1 })}><ChevronRight size={15} /></button></div></div>}
    </>}

    <details className="group border-t border-slate-800 p-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs text-slate-400"><span className="flex items-center gap-2"><Info size={14} />Cách tính khách mua liên tiếp</span><ChevronDown size={14} className="transition group-open:rotate-180" /></summary><ul className="mt-3 list-disc space-y-2 pl-5 text-[11px] leading-5 text-slate-500"><li>Ghép cùng khách và cùng sản phẩm; bỏ một ngày sẽ ngắt chuỗi. Chọn khoảng 2–7 ngày sẽ lấy khách có chuỗi dài nhất từ 2 đến 7 ngày, không gồm chuỗi 8 ngày trở lên. Để trống giới hạn trên nếu muốn lấy mọi chuỗi từ số ngày tối thiểu.</li><li>Nhiều lượt mua trong cùng ngày chỉ tính một ngày. Một lần thanh toán nhiều sản phẩm là một lượt mua; giao tách ngày không tạo thêm lượt mua.</li><li>Dùng ngày đặt mua của đơn đã giao thành công, theo giờ Việt Nam (UTC+7). Phần doanh thu phía trên dùng ngày giao hàng nên số liệu có thể khác.</li><li>Chỉ xét các ngày nằm trong khoảng báo cáo đang chọn. Lượt mua và chi tiêu trong bảng là tổng của cặp khách — sản phẩm trong cả kỳ, sau giảm giá.</li></ul></details>
  </section>;
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-cyan-100">{value}</p><p className="mt-2 text-[11px] leading-5 text-slate-500">{detail}</p></div>;
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function isStreakDays(value: unknown): value is number { return isCount(value) && value >= 2 && value <= 366; }
function isDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00+07:00`).getTime()); }
function isOptionalText(value: unknown) { return value === null || typeof value === 'string'; }
function isRepeatReport(value: unknown): value is RepeatReport {
  if (!isRecord(value) || !isRecord(value.range) || !isRecord(value.summary) || !isRecord(value.pagination)) return false;
  const { range, summary, pagination } = value;
  if (!isDate(range.from) || !isDate(range.to) || !isCount(range.days) || typeof value.timezone !== 'string' || !isStreakDays(value.days) || !(value.maxDays === null || (isStreakDays(value.maxDays) && value.maxDays >= value.days))) return false;
  if (!isCount(summary.buyers) || !isCount(summary.repeatBuyers) || summary.repeatBuyers > summary.buyers || !(summary.repeatRate === null || (typeof summary.repeatRate === 'number' && Number.isFinite(summary.repeatRate) && summary.repeatRate >= 0 && summary.repeatRate <= 100))) return false;
  if (!isCount(pagination.page) || pagination.page < 1 || !isCount(pagination.limit) || pagination.limit < 1 || !isCount(pagination.total) || !isCount(pagination.totalPages)) return false;
  if (!Array.isArray(value.products) || !value.products.every((product) => isRecord(product) && typeof product.productId === 'string' && typeof product.name === 'string')) return false;
  return Array.isArray(value.items) && value.items.every((item) => isRecord(item)
    && typeof item.userId === 'string' && typeof item.productId === 'string' && typeof item.productName === 'string'
    && isOptionalText(item.telegramId) && isOptionalText(item.username) && isOptionalText(item.displayName)
    && isCount(item.purchaseCount) && isCount(item.quantity) && typeof item.totalSpent === 'number' && Number.isFinite(item.totalSpent) && item.totalSpent >= 0
    && Array.isArray(item.purchaseDays) && item.purchaseDays.every(isDate) && isCount(item.longestStreak) && item.longestStreak >= (value.days as number) && (value.maxDays === null || item.longestStreak <= (value.maxDays as number))
    && isDate(item.streakFrom) && isDate(item.streakTo) && typeof item.lastPurchaseAt === 'string' && Number.isFinite(new Date(item.lastPurchaseAt).getTime()));
}
