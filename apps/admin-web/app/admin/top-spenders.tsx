'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, LoaderCircle, RefreshCw, Trophy, Users } from 'lucide-react';
import type { AuthorizedRequest } from './operations-dashboard';

interface TopCustomer {
  rank: number;
  userId: string;
  telegramId: string | null;
  username: string | null;
  displayName: string | null;
  totalSpent: number;
  purchaseCount: number;
  quantity: number;
  lastPurchaseAt: string;
}

interface SpendingInsights {
  generatedAt: string;
  range: { from: string; to: string };
  revenue: { net: number; buyers: number };
  topCustomers: TopCustomer[];
}

interface DateRange { from: string; to: string; }
const dayMs = 86_400_000;
const numberFormat = new Intl.NumberFormat('vi-VN');
const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
});
const money = (value: number) => `${numberFormat.format(value)} đ`;

function recentDays(days: number): DateRange {
  const to = new Date(Date.now() + 7 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * dayMs).toISOString().slice(0, 10);
  return { from, to };
}

export function TopSpenders({ authorized, refreshVersion = 0 }: {
  authorized: AuthorizedRequest;
  refreshVersion?: number;
}) {
  const [range, setRange] = useState<DateRange>(() => recentDays(30));
  const [draft, setDraft] = useState<DateRange>(range);
  const [preset, setPreset] = useState<number | null>(30);
  const [data, setData] = useState<SpendingInsights | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setBusy(true);
      setError('');
      setData(null);
      try {
        const query = new URLSearchParams({ from: range.from, to: range.to });
        const response = await authorized(`/admin/analytics/insights?${query}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) {
          const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
          throw new Error(typeof message === 'string' ? message : 'Không thể tải bảng xếp hạng chi tiêu.');
        }
        if (!Array.isArray(body?.topCustomers) || !body?.range || !body?.revenue) {
          throw new Error('Dữ liệu bảng xếp hạng không hợp lệ. Vui lòng thử lại.');
        }
        if (!controller.signal.aborted) setData(body);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof SyntaxError
          ? 'Không thể đọc dữ liệu bảng xếp hạng. Vui lòng thử lại.'
          : cause instanceof Error ? cause.message : 'Không thể tải bảng xếp hạng chi tiêu.');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [authorized, range, refreshVersion, retry]);

  function choosePreset(days: number) {
    const next = recentDays(days);
    setPreset(days);
    setDraft(next);
    setRange(next);
    setValidationError('');
  }

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Native date-picker/autofill values may not yet be reflected in React state.
    const fields = new FormData(event.currentTarget);
    const submitted = { from: String(fields.get('from') ?? ''), to: String(fields.get('to') ?? '') };
    const days = (Date.parse(submitted.to) - Date.parse(submitted.from)) / dayMs + 1;
    if (!Number.isFinite(days) || days < 1 || days > 366) {
      setValidationError('Chọn từ 1 đến 366 ngày, ngày bắt đầu không sau ngày kết thúc.');
      return;
    }
    setValidationError('');
    setPreset(null);
    setDraft(submitted);
    setRange(submitted);
  }

  return <section className="admin-card min-w-0 overflow-hidden" aria-labelledby="top-spenders-title">
    <div className="space-y-5 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300"><Trophy size={20} /></span>
          <div>
            <h2 id="top-spenders-title" className="font-semibold text-slate-100">Top khách hàng chi tiêu nhiều nhất</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">Top 20 theo tổng tiền mua hàng, từ cao xuống thấp.</p>
          </div>
        </div>
        <button type="button" onClick={() => setRetry((value) => value + 1)} disabled={busy}
          className="button-secondary inline-flex shrink-0 items-center gap-2 px-3 py-2 text-xs" aria-label="Làm mới bảng chi tiêu">
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /><span className="hidden sm:inline">Làm mới</span>
        </button>
      </div>
      <div className="flex flex-col flex-wrap gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Khoảng thời gian chi tiêu">
          {[[1, 'Hôm nay'], [7, '7 ngày'], [30, '30 ngày'], [90, '90 ngày']].map(([days, label]) =>
            <button key={days} type="button" onClick={() => choosePreset(Number(days))} aria-pressed={preset === days}
              className={`rounded-lg border px-3 py-2 text-xs transition ${preset === days
                ? 'border-indigo-300/40 bg-indigo-300/10 text-indigo-200'
                : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'}`}>{label}</button>)}
        </div>
        <form onSubmit={applyRange} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[140px] flex-1 text-xs text-slate-400 sm:flex-none">Từ ngày
            <input type="date" name="from" required value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              className="input mt-1 h-10 min-w-0 py-2" />
          </label>
          <label className="min-w-[140px] flex-1 text-xs text-slate-400 sm:flex-none">Đến ngày
            <input type="date" name="to" required value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              className="input mt-1 h-10 min-w-0 py-2" />
          </label>
          <button type="submit" className="button-secondary h-10 px-3 py-2 text-xs">Áp dụng</button>
        </form>
      </div>
      {validationError && <p role="alert" className="text-xs text-amber-300">{validationError}</p>}
      <p className="text-xs leading-5 text-slate-500">Chỉ tính tiền sau giảm giá của đơn đã giao; không gồm tiền nạp ví, đơn hủy hoặc hoàn tiền. Lọc theo ngày giao (giờ Việt Nam); đơn cũ thiếu ngày giao dùng ngày tạo.</p>
    </div>

    <div aria-busy={busy} aria-live="polite">
      {busy ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-400">
        <LoaderCircle size={18} className="animate-spin" />Đang tải bảng xếp hạng…
      </div> : error ? <div role="alert" className="mx-5 mb-5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200 sm:mx-6">
        <p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 underline underline-offset-4">Thử lại</button>
      </div> : data && <>
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-800 bg-slate-950/30 px-5 py-3 text-xs text-slate-400 sm:px-6">
          <span>{data.range.from.split('-').reverse().join('/')} – {data.range.to.split('-').reverse().join('/')} · {numberFormat.format(data.revenue.buyers)} khách đã mua</span>
          <span>Tổng chi tiêu trong kỳ: <strong className="font-semibold text-emerald-300">{money(data.revenue.net)}</strong></span>
        </div>
        {data.topCustomers.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-5 text-center text-sm text-slate-500">
          <Users size={24} /><p>Chưa có khách mua hàng trong khoảng thời gian này.</p>
        </div> : <div className="relative overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <caption className="sr-only">Top 20 khách hàng theo tổng chi tiêu trong kỳ, giảm dần</caption>
            <thead className="border-b border-slate-800 text-xs text-slate-500">
              <tr><th scope="col" className="px-5 py-3 font-medium sm:pl-6">Hạng</th>
                <th scope="col" className="px-3 py-3 font-medium">Khách hàng</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Tổng chi tiêu</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Lượt mua</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Số lượng</th>
                <th scope="col" className="px-3 py-3 font-medium">Mua gần nhất</th>
                <th scope="col" className="px-5 py-3 sm:pr-6"><span className="sr-only">Lịch sử đơn hàng</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.topCustomers.map((customer) => {
                const username = customer.username?.replace(/^@+/, '').trim();
                const name = customer.displayName || (username ? `@${username}` : customer.telegramId ? `Telegram ${customer.telegramId}` : 'Khách đã xóa');
                const rankTone = customer.rank === 1 ? 'bg-amber-400/15 text-amber-300'
                  : customer.rank === 2 ? 'bg-slate-300/10 text-slate-200'
                    : customer.rank === 3 ? 'bg-orange-400/10 text-orange-300' : 'text-slate-500';
                return <tr key={customer.userId} className="transition hover:bg-slate-800/30">
                  <td className="px-5 py-4 sm:pl-6"><span className={`inline-flex size-8 items-center justify-center rounded-lg font-semibold tabular-nums ${rankTone}`}>{customer.rank}</span></td>
                  <td className="max-w-64 px-3 py-4"><p className="truncate font-medium text-slate-100" title={name}>{name}</p>
                    {username && <a href={`https://t.me/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-sky-300 hover:underline">@{username}</a>}
                    {customer.telegramId && <p className="mt-1 font-mono text-[11px] text-slate-500">ID {customer.telegramId}</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-right font-semibold tabular-nums text-emerald-300">{money(customer.totalSpent)}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-slate-300">{numberFormat.format(customer.purchaseCount)}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-slate-300">{numberFormat.format(customer.quantity)}</td>
                  <td className="whitespace-nowrap px-3 py-4 text-xs text-slate-400">{dateFormat.format(new Date(customer.lastPurchaseAt))}</td>
                  <td className="px-5 py-4 sm:pr-6"><a href={`/admin?view=orders&userId=${encodeURIComponent(customer.userId)}`}
                    aria-label={`Xem tất cả đơn hàng của ${name}`} className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-indigo-300 hover:text-indigo-200">Xem đơn<ArrowUpRight size={14} /></a></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-800 px-5 py-3 text-[11px] leading-5 text-slate-500 sm:px-6">
          <p>Hiển thị {data.topCustomers.length}/{numberFormat.format(data.revenue.buyers)} khách · Một lượt mua có thể gồm nhiều sản phẩm.</p>
          <p>Cập nhật {dateFormat.format(new Date(data.generatedAt))} (giờ Việt Nam)</p>
        </div>
      </>}
    </div>
  </section>;
}
