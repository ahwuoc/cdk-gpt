'use client';

import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { ArrowUpRight, CalendarDays, ChartNoAxesCombined, ChevronDown, CircleDollarSign, Info, LoaderCircle, Package, RefreshCw, ShoppingBag, Trophy, Users } from 'lucide-react';
import type { AuthorizedRequest } from './operations-dashboard';
import { analyticsPresetRange } from './analytics-date-range';
import { ProductRepeatPurchases } from './product-repeat-purchases';

interface RevenueDay { date: string; net: number; gross: number; discount: number; purchaseCount: number; orderCount: number; quantity: number; }
interface RankedCustomer {
  rank: number; userId: string; telegramId?: string; username?: string; displayName?: string;
  totalSpent: number; purchaseCount: number; orderCount: number; quantity: number; lastPurchaseAt?: string;
}
interface RankedProduct { productId: string; name: string; slug?: string; revenue: number; quantity: number; purchaseCount: number; buyers: number; }
interface GrowthInsights {
  generatedAt: string; timezone: string; range: { from: string; to: string; days: number };
  revenue: { net: number; gross: number; discount: number; purchaseCount: number; orderCount: number; quantity: number; buyers: number; averagePurchaseValue: number };
  deposits: { amount: number; count: number }; timeline: RevenueDay[];
  topCustomers: RankedCustomer[]; topProducts: RankedProduct[];
  behavior: {
    newCustomers: number; activeUsers: number; productViewers: number; checkoutStarters: number;
    buyers: number; viewerBuyers: number; checkoutBuyers: number; viewToPurchaseRate: number | null;
    checkoutToPurchaseRate: number | null; repeatBuyers: number; returningBuyers: number; newBuyers: number;
    abandonedCheckouts: number; abandonedCheckoutAmount: number; collectionStartedAt: string | null; eventsInRange: number;
  };
  notes: string[];
}
interface DateRange { from: string; to: string; }
const integer = (value: number) => value.toLocaleString('vi-VN');
const money = (value: number) => `${Math.round(value).toLocaleString('vi-VN')} ₫`;
const rate = (value: number | null) => value == null ? '—' : `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
const dayMs = 86_400_000;

export function GrowthAnalytics({ authorized }: { authorized: AuthorizedRequest }) {
  const [range, setRange] = useState<DateRange>(() => analyticsPresetRange('month'));
  const [draftRange, setDraftRange] = useState<DateRange>(() => analyticsPresetRange('month'));
  const [preset, setPreset] = useState('month');
  const [rangeError, setRangeError] = useState('');
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<GrowthInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setLoading(true); setError(''); setData(null);
      try {
        const query = new URLSearchParams({ from: range.from, to: range.to });
        const response = await authorized(`/admin/analytics/insights?${query}`, { signal: controller.signal });
        const body = await response.json().catch(() => null) as GrowthInsights & { message?: string | string[] } | null;
        if (!response.ok || !body) throw new Error(Array.isArray(body?.message) ? body.message.join('. ') : body?.message || 'Không thể tải báo cáo phân tích.');
        if (!body.revenue || !body.behavior || !body.deposits || !Array.isArray(body.timeline)
          || !Array.isArray(body.topCustomers) || !Array.isArray(body.topProducts) || !Array.isArray(body.notes)) {
          throw new Error('Dữ liệu báo cáo chưa đầy đủ. Vui lòng thử lại.');
        }
        if (!controller.signal.aborted) setData(body);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Không thể tải báo cáo phân tích.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    });
    return () => controller.abort();
  }, [authorized, range, version]);

  function choosePreset(value: string) {
    const next = analyticsPresetRange(value);
    setPreset(value); setRangeError(''); setDraftRange(next); setRange(next); setLoading(true);
  }
  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read the submitted controls, including native date-picker/autofill changes.
    const fields = new FormData(event.currentTarget);
    const submitted = { from: String(fields.get('from') ?? ''), to: String(fields.get('to') ?? '') };
    const from = new Date(submitted.from).getTime(); const to = new Date(submitted.to).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      setRangeError('Hãy chọn ngày bắt đầu không sau ngày kết thúc.'); return;
    }
    if (Math.round((to - from) / dayMs) + 1 > 366) {
      setRangeError('Mỗi báo cáo hỗ trợ tối đa 366 ngày. Vui lòng rút ngắn khoảng thời gian.'); return;
    }
    setRangeError(''); setPreset('custom'); setDraftRange(submitted); setRange(submitted); setLoading(true);
  }

  return <section className="space-y-6" aria-label="Phân tích doanh thu và khách hàng">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300">Tăng trưởng · Analytics</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">Hiểu khách hàng. Hiểu doanh thu.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Nhìn rõ ai đang mua, sản phẩm tạo doanh thu và hành vi dẫn đến lượt mua thành công.</p></div>
      <button type="button" disabled={loading} onClick={() => setVersion((current) => current + 1)} className="button-secondary inline-flex items-center gap-2"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Làm mới</button>
    </div>

    <div className="admin-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Khoảng thời gian nhanh">{[['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['7', '7 ngày'], ['30', '30 ngày'], ['90', '90 ngày']].map(([value, label]) => <button key={value} type="button" aria-pressed={preset === value} onClick={() => choosePreset(value)} className={`rounded-lg px-3 py-2 text-xs font-medium transition ${preset === value ? 'bg-indigo-400/15 text-indigo-200 ring-1 ring-inset ring-indigo-400/30' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>{label}</button>)}</div>
        <form onSubmit={applyRange} className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="min-w-0"><span className="mb-1 block text-[10px] text-slate-500">Từ ngày · VN</span><input type="date" name="from" required className="input max-w-[160px] !py-2 text-xs" value={draftRange.from} onChange={(event) => setDraftRange({ ...draftRange, from: event.target.value })} aria-label="Ngày bắt đầu báo cáo" /></label>
          <label className="min-w-0"><span className="mb-1 block text-[10px] text-slate-500">Đến hết ngày · VN</span><input type="date" name="to" required className="input max-w-[160px] !py-2 text-xs" value={draftRange.to} onChange={(event) => setDraftRange({ ...draftRange, to: event.target.value })} aria-label="Ngày kết thúc báo cáo" /></label>
          <button type="submit" className="button-secondary !py-2 text-xs">Áp dụng</button>
        </form>
      </div>
      {rangeError && <p role="alert" className="mt-3 text-xs text-rose-300">{rangeError}</p>}
      <p className="mt-4 flex items-center gap-2 border-t border-slate-800 pt-3 text-[11px] leading-5 text-slate-500"><CalendarDays size={13} className="shrink-0" />{dateOnly(range.from)} — {dateOnly(range.to)} · Múi giờ Việt Nam (UTC+7){data && <span className="ml-auto hidden sm:inline">Cập nhật {timestamp(data.generatedAt)}</span>}</p>
    </div>

    {loading ? <AnalyticsLoading /> : error ? <div role="alert" className="admin-card p-10 text-center"><ChartNoAxesCombined size={28} className="mx-auto text-slate-600" /><h2 className="mt-4 font-medium text-slate-200">Chưa tải được báo cáo</h2><p className="mx-auto mt-2 max-w-xl text-sm text-rose-300">{error}</p><button type="button" onClick={() => setVersion((current) => current + 1)} className="button-secondary mt-5">Thử lại</button></div> : data && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Doanh thu thực thu" value={money(data.revenue.net)} detail="Đơn đã giao, sau giảm giá" icon={<CircleDollarSign size={19} />} accent />
        <MetricCard label="Lượt mua thành công" value={integer(data.revenue.purchaseCount)} detail={`${integer(data.revenue.quantity)} sản phẩm đã giao`} icon={<ShoppingBag size={19} />} />
        <MetricCard label="Giá trị trung bình / lượt" value={money(data.revenue.averagePurchaseValue)} detail="Doanh thu ÷ lượt mua thành công" icon={<ChartNoAxesCombined size={19} />} />
        <MetricCard label="Khách đã mua" value={integer(data.revenue.buyers)} detail="Khách duy nhất có đơn đã giao" icon={<Users size={19} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ConversionCard label="Tỷ lệ khách hoạt động có mua"
          percent={data.behavior.eventsInRange > 0 && data.behavior.activeUsers > 0 ? data.revenue.buyers / data.behavior.activeUsers * 100 : null}
          numerator={data.revenue.buyers} denominator={data.behavior.activeUsers}
          detail={data.behavior.eventsInRange > 0
            ? 'Khách đã mua ÷ khách có tương tác được ghi nhận hoặc có đơn đã giao trong kỳ. Không đại diện cho toàn bộ khách đã đăng ký.'
            : 'Chưa có dữ liệu tương tác trong kỳ để đánh giá tỷ lệ này. Số khách mua vẫn được tính từ đơn đã giao.'} />
        <ConversionCard label="Tỷ lệ khách mua lặp lại"
          percent={data.revenue.buyers > 0 ? data.behavior.repeatBuyers / data.revenue.buyers * 100 : null}
          numerator={data.behavior.repeatBuyers} denominator={data.revenue.buyers}
          detail="Khách có ít nhất 2 lượt mua thành công ÷ tổng khách đã mua trong kỳ. Một lần thanh toán nhiều sản phẩm vẫn là một lượt mua." />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <RevenueChart days={data.timeline} net={data.revenue.net} />
        <div className="admin-card p-5">
          <h2 className="text-sm font-semibold text-slate-100">Doanh thu được tính thế nào?</h2>
          <div className="mt-5 space-y-4"><AmountRow label="Giá trị trước giảm giá" value={money(data.revenue.gross)} /><AmountRow label="Giảm giá đã áp dụng" value={`− ${money(data.revenue.discount)}`} tone="text-amber-300" /><div className="border-t border-slate-800 pt-4"><AmountRow label="Thực thu đơn đã giao" value={money(data.revenue.net)} tone="text-indigo-200" /></div></div>
          <p className="mt-4 text-[11px] leading-5 text-slate-500">Ghi nhận theo ngày giao hàng. Không gồm đơn chờ giao, thất bại hoặc đã hoàn tiền.</p>
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Tách biệt với doanh thu</p><p className="mt-2 text-sm font-semibold tabular-nums text-slate-200">{money(data.deposits.amount)}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{integer(data.deposits.count)} lượt nạp ví thành công trong kỳ. Nạp ví chưa phải là mua hàng.</p></div>
        </div>
      </div>

    </>}

    <ProductRepeatPurchases authorized={authorized} from={range.from} to={range.to} refreshVersion={version} />

    {!loading && !error && data && <>
      <div className="admin-card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 p-5"><div className="flex gap-3"><Trophy size={20} className="mt-0.5 text-amber-300" /><div><h2 className="font-semibold text-slate-100">Khách hàng chi tiêu nhiều nhất</h2><p className="mt-1 text-xs leading-5 text-slate-500">Xếp hạng theo số tiền thực mua của đơn đã giao trong kỳ, không phải số tiền nạp ví.</p></div></div><span className="rounded-md border border-slate-700 px-2 py-1 text-[10px] font-medium tracking-wider text-slate-400">TOP {data.topCustomers.length || '—'}</span></div>
        {!data.topCustomers.length ? <EmptyState icon={<Trophy size={25} />} title="Chưa có khách trong bảng xếp hạng" detail="Các lượt mua đã giao trong khoảng ngày này sẽ xuất hiện tại đây." /> : <div className="max-h-[560px] overflow-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-medium">Hạng</th><th className="px-5 py-3 font-medium">Khách hàng</th><th className="px-5 py-3 text-right font-medium">Đã chi tiêu</th><th className="px-5 py-3 text-right font-medium">Lượt mua</th><th className="px-5 py-3 text-right font-medium">Sản phẩm</th><th className="px-5 py-3 font-medium">Mua gần nhất</th><th className="px-5 py-3"><span className="sr-only">Lịch sử</span></th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">{data.topCustomers.map((customer) => <tr key={customer.userId} className="transition hover:bg-slate-800/20"><td className="px-5 py-4"><span className={`inline-flex size-7 items-center justify-center rounded-lg text-xs font-semibold tabular-nums ${customer.rank === 1 ? 'border border-amber-300/30 bg-amber-300/10 text-amber-200' : customer.rank <= 3 ? 'border border-indigo-300/20 bg-indigo-300/5 text-indigo-200' : 'text-slate-500'}`}>{customer.rank}</span></td>
            <td className="max-w-[250px] px-5 py-4"><p className="truncate font-medium text-slate-200">{customer.displayName || (customer.username ? `@${customer.username}` : customer.telegramId ? `Khách ${customer.telegramId}` : 'Khách đã xóa')}</p><p className="mt-1 truncate font-mono text-[11px] text-slate-500">{customer.username && customer.displayName ? `@${customer.username} · ` : ''}{customer.telegramId || customer.userId}</p></td>
            <td className="px-5 py-4 text-right font-semibold tabular-nums text-indigo-200">{money(customer.totalSpent)}</td><td className="px-5 py-4 text-right tabular-nums text-slate-300">{integer(customer.purchaseCount)}</td><td className="px-5 py-4 text-right tabular-nums text-slate-400">{integer(customer.quantity)}</td><td className="px-5 py-4 text-[11px] text-slate-500">{customer.lastPurchaseAt ? timestamp(customer.lastPurchaseAt) : '—'}</td><td className="px-5 py-4"><a href={`?view=orders&userId=${encodeURIComponent(customer.userId)}`} className="inline-flex rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-indigo-200" aria-label={`Xem đơn hàng của ${customer.displayName || customer.username || customer.telegramId || 'khách hàng'}`}><ArrowUpRight size={16} /></a></td>
          </tr>)}</tbody></table></div>}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <ProductRanking products={data.topProducts} />
        <div className="admin-card p-5"><div className="flex items-center gap-2"><Users size={18} className="text-indigo-300" /><h2 className="text-sm font-semibold text-slate-100">Khách mới & khách quay lại</h2></div>
          <div className="mt-6 grid grid-cols-2 gap-4"><SmallMetric label="Khách mua lần đầu" value={data.behavior.newBuyers} detail="Lần mua đầu tiên trong kỳ" /><SmallMetric label="Khách quay lại mua" value={data.behavior.returningBuyers} detail="Đã mua trước khi kỳ bắt đầu" /></div>
          <CustomerSplit newBuyers={data.behavior.newBuyers} returningBuyers={data.behavior.returningBuyers} />
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-800 pt-5"><SmallMetric label="Mua lặp lại trong kỳ" value={data.behavior.repeatBuyers} detail="Có ít nhất 2 lượt mua trong kỳ" /><SmallMetric label="Khách mới đăng ký" value={data.behavior.newCustomers} detail="Không nhất thiết đã mua hàng" /></div>
          <p className="mt-4 text-[11px] leading-5 text-slate-500">Khách mua lặp lại có thể là khách mới hoặc khách quay lại; không cộng chỉ số này vào hai nhóm phía trên.</p>
        </div>
      </div>

      <div className="admin-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-100">Từ tương tác đến mua hàng</h2><p className="mt-1 text-xs leading-5 text-slate-500">Đếm khách duy nhất và tỷ lệ mua trong cùng kỳ báo cáo.</p></div><span className="rounded-md border border-indigo-400/20 bg-indigo-400/5 px-2 py-1 text-[10px] text-indigo-300">{integer(data.behavior.eventsInRange)} sự kiện ghi nhận</span></div>
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-6 text-amber-100/80"><Info size={15} className="mt-1 shrink-0" /><p>{data.behavior.collectionStartedAt ? `Bắt đầu có dữ liệu hành vi từ ${timestamp(data.behavior.collectionStartedAt)} (giờ VN). ` : 'Chưa ghi nhận sự kiện hành vi. '}Lịch sử xem sản phẩm trước thời điểm thu thập không được tái tạo. Không có mẫu đo sẽ hiển thị “—”, không coi là chuyển đổi 0%.</p></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3"><SmallMetric label="Khách hoạt động" value={data.behavior.activeUsers} detail="Có tương tác được ghi nhận hoặc đơn đã giao" /><SmallMetric label="Khách xem sản phẩm" value={data.behavior.productViewers} detail="Có ít nhất một lượt xem sản phẩm" /><SmallMetric label="Khách bắt đầu thanh toán" value={data.behavior.checkoutStarters} detail="Có sự kiện bắt đầu mua hàng" /></div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2"><ConversionCard label="Xem sản phẩm → có mua hàng" percent={data.behavior.viewToPurchaseRate} numerator={data.behavior.viewerBuyers} denominator={data.behavior.productViewers} detail="Khách xem sản phẩm rồi có đơn đã giao sau lượt xem trong cùng kỳ; có thể mua sản phẩm khác." /><ConversionCard label="Bắt đầu thanh toán → có mua hàng" percent={data.behavior.checkoutToPurchaseRate} numerator={data.behavior.checkoutBuyers} denominator={data.behavior.checkoutStarters} detail="Khách bắt đầu thanh toán rồi có đơn đã giao sau đó trong cùng kỳ báo cáo." /></div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">Hai tỷ lệ đo riêng từng nhóm khách, không phải các bước bắt buộc của cùng một phiên và không khẳng định lượt xem gây ra lượt mua.</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div><p className="text-sm font-medium text-slate-300">Thanh toán sản phẩm bị bỏ dở</p><p className="mt-1 text-xs leading-5 text-slate-500">Yêu cầu mua qua QR tạo trong kỳ, chưa thanh toán và đã hết hạn. Không gồm nạp ví.</p></div><div className="text-right"><p className="text-lg font-semibold tabular-nums text-slate-200">{integer(data.behavior.abandonedCheckouts)} <span className="text-xs font-normal text-slate-500">lượt</span></p><p className="mt-1 text-xs tabular-nums text-slate-500">{money(data.behavior.abandonedCheckoutAmount)}</p></div></div>
      </div>

      <details className="admin-card group p-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-300"><span className="flex items-center gap-2"><Info size={16} className="text-slate-500" />Định nghĩa & giới hạn dữ liệu</span><ChevronDown size={16} className="transition group-open:rotate-180" /></summary><ul className="mt-4 list-disc space-y-2 pl-5 text-xs leading-6 text-slate-500"><li>Một lượt thanh toán QR nhiều sản phẩm được tính là một lượt mua. Số sản phẩm và số dòng đơn có thể lớn hơn số lượt mua.</li><li>Đơn cũ thiếu ngày giao được quy về ngày tạo; trạng thái hoàn tiền có thể làm thay đổi báo cáo khi tải lại.</li>{data.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>
    </>}
  </section>;
}

function MetricCard({ label, value, detail, icon, accent = false }: { label: string; value: string; detail: string; icon: ReactNode; accent?: boolean }) {
  return <div className={`admin-card min-w-0 p-5 ${accent ? 'border-indigo-400/25 bg-indigo-400/5' : ''}`}><div className="flex items-center justify-between gap-2"><p className="text-xs text-slate-400">{label}</p><span className={accent ? 'text-indigo-300' : 'text-slate-500'}>{icon}</span></div><p className={`mt-5 break-words text-[26px] font-semibold leading-tight tracking-tight tabular-nums ${accent ? 'text-indigo-100' : 'text-slate-100'}`}>{value}</p><p className="mt-3 text-[11px] leading-5 text-slate-500">{detail}</p></div>;
}
function AmountRow({ label, value, tone = 'text-slate-300' }: { label: string; value: string; tone?: string }) { return <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-slate-500">{label}</span><span className={`font-medium tabular-nums ${tone}`}>{value}</span></div>; }
function SmallMetric({ label, value, detail }: { label: string; value: number; detail: string }) { return <div><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">{integer(value)}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p></div>; }
function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) { return <div className="px-5 py-12 text-center"><span className="inline-block text-slate-600">{icon}</span><p className="mt-3 text-sm text-slate-300">{title}</p><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">{detail}</p></div>; }

function CustomerSplit({ newBuyers, returningBuyers }: { newBuyers: number; returningBuyers: number }) {
  const total = newBuyers + returningBuyers;
  return <div className="mt-5"><div className="flex h-2.5 overflow-hidden rounded-full bg-slate-800" aria-label={total ? `${rate(newBuyers / total * 100)} khách mua lần đầu, ${rate(returningBuyers / total * 100)} khách quay lại` : 'Chưa có khách mua trong kỳ'}>{total > 0 && <><span className="bg-indigo-400" style={{ width: `${newBuyers / total * 100}%` }} /><span className="bg-cyan-300" style={{ width: `${returningBuyers / total * 100}%` }} /></>}</div><div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500"><span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-indigo-400" />Lần đầu {total ? rate(newBuyers / total * 100) : '—'}</span><span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-cyan-300" />Quay lại {total ? rate(returningBuyers / total * 100) : '—'}</span></div></div>;
}
function ConversionCard({ label, percent, numerator, denominator, detail }: { label: string; percent: number | null; numerator: number; denominator: number; detail: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex items-start justify-between gap-3"><h3 className="text-xs font-medium leading-5 text-slate-300">{label}</h3><span className="text-xl font-semibold tabular-nums text-indigo-200">{rate(percent)}</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} /></div><p className="mt-3 text-xs tabular-nums text-slate-400">{integer(numerator)} / {integer(denominator)} khách{denominator === 0 ? ' · Chưa có mẫu đo' : ''}</p><p className="mt-2 text-[11px] leading-5 text-slate-500">{detail}</p></div>;
}
function ProductRanking({ products }: { products: RankedProduct[] }) {
  const maximum = Math.max(1, ...products.map((product) => product.revenue));
  return <div className="admin-card overflow-hidden"><div className="flex items-center gap-2 border-b border-slate-800 p-5"><Package size={18} className="text-indigo-300" /><h2 className="text-sm font-semibold text-slate-100">Sản phẩm tạo doanh thu</h2></div>{!products.length ? <EmptyState icon={<Package size={25} />} title="Chưa có sản phẩm bán trong kỳ" detail="Chỉ những sản phẩm có đơn đã giao mới được xếp hạng." /> : <div className="max-h-[480px] divide-y divide-slate-800/70 overflow-y-auto">{products.map((product, index) => <div key={product.productId} className="px-5 py-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-3"><span className="mt-0.5 text-xs tabular-nums text-slate-600">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-200" title={product.name}>{product.name || 'Sản phẩm đã xóa'}</p><p className="mt-1 text-[11px] text-slate-500">{integer(product.quantity)} sản phẩm · {integer(product.buyers)} khách</p></div></div><span className="shrink-0 text-xs font-medium tabular-nums text-slate-300">{money(product.revenue)}</span></div><div className="ml-7 mt-3 h-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-indigo-400/70" style={{ width: `${Math.max(0, product.revenue / maximum * 100)}%` }} /></div></div>)}</div>}</div>;
}

function RevenueChart({ days, net }: { days: RevenueDay[]; net: number }) {
  const gradientId = useId().replace(/:/g, '');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const chart = useMemo(() => {
    const left = 62; const right = 780; const top = 20; const bottom = 204;
    const max = Math.max(1, ...days.map((day) => day.net));
    const coordinates = days.map((day, index) => ({ x: days.length === 1 ? (left + right) / 2 : left + index / Math.max(1, days.length - 1) * (right - left), y: bottom - (day.net / max) * (bottom - top) }));
    const line = coordinates.map(({ x, y }) => `${x},${y}`).join(' ');
    const indices = Array.from(new Set([0, Math.floor((days.length - 1) / 4), Math.floor((days.length - 1) / 2), Math.floor((days.length - 1) * 3 / 4), days.length - 1])).filter((index) => index >= 0);
    return { left, right, top, bottom, max, coordinates, line, indices };
  }, [days]);
  const safeIndex = Math.min(selectedIndex ?? Math.max(0, days.length - 1), Math.max(0, days.length - 1));
  const selectedDay = days[safeIndex];
  const point = chart.coordinates[safeIndex];

  return <div className="admin-card min-w-0 overflow-hidden p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-100">Doanh thu theo ngày</h2><p className="mt-1 text-[11px] text-slate-500">Đơn đã giao · sau giảm giá · VND</p></div><span className="text-xl font-semibold tracking-tight tabular-nums text-indigo-100">{money(net)}</span></div>
    {!days.length ? <EmptyState icon={<ChartNoAxesCombined size={25} />} title="Chưa có dữ liệu biểu đồ" detail="Thử tải lại hoặc chọn khoảng thời gian khác." /> : <>
      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-slate-950/40 px-3 py-2"><p className="text-xs text-slate-500">{selectedDay ? dateOnly(selectedDay.date) : '—'}</p><p className="text-xs tabular-nums text-slate-300">{selectedDay ? money(selectedDay.net) : '—'} <span className="ml-2 text-slate-600">· {selectedDay ? integer(selectedDay.purchaseCount) : '—'} lượt mua</span></p></div>
      <svg viewBox="0 0 800 244" className="mt-4 h-auto w-full" role="img" aria-label={`Biểu đồ doanh thu ${days.length} ngày, tổng ${money(net)}. Dữ liệu chi tiết ở bảng bên dưới.`}>
        <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#a5b4fc" stopOpacity="0.18" /><stop offset="100%" stopColor="#a5b4fc" stopOpacity="0.01" /></linearGradient></defs>
        {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1={chart.left} x2={chart.right} y1={chart.bottom - fraction * (chart.bottom - chart.top)} y2={chart.bottom - fraction * (chart.bottom - chart.top)} stroke="#1e293b" strokeDasharray="4 5" /><text x={chart.left - 10} y={chart.bottom - fraction * (chart.bottom - chart.top) + 4} textAnchor="end" fill="#64748b" fontSize="10">{compactMoney(fraction * chart.max)}</text></g>)}
        {days.length > 1 && <polygon points={`${chart.coordinates[0]?.x},${chart.bottom} ${chart.line} ${chart.coordinates.at(-1)?.x},${chart.bottom}`} fill={`url(#${gradientId})`} />}
        <polyline points={chart.line} fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {point && <><line x1={point.x} x2={point.x} y1={chart.top} y2={chart.bottom} stroke="#818cf8" strokeDasharray="3 4" strokeOpacity="0.35" /><circle cx={point.x} cy={point.y} r="4" fill="#c7d2fe" stroke="#0f172a" strokeWidth="2" /></>}
        {chart.indices.map((index) => <text key={index} x={chart.coordinates[index]?.x} y="230" textAnchor={index === 0 && days.length > 1 ? 'start' : index === days.length - 1 && days.length > 1 ? 'end' : 'middle'} fill="#64748b" fontSize="10">{shortDate(days[index].date)}</text>)}
        {days.map((day, index) => <rect key={day.date} x={chart.coordinates[index].x - ((chart.right - chart.left) / Math.max(1, days.length - 1)) / 2} y={chart.top} width={(chart.right - chart.left) / Math.max(1, days.length - 1)} height={chart.bottom - chart.top} fill="transparent" onPointerEnter={() => setSelectedIndex(index)}><title>{dateOnly(day.date)}: {money(day.net)}, {day.purchaseCount} lượt mua</title></rect>)}
      </svg>
      {days.length > 1 && <label className="mt-1 flex items-center gap-3 text-[10px] text-slate-500"><span className="shrink-0">Xem từng ngày</span><input type="range" min="0" max={days.length - 1} value={safeIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))} className="h-1 w-full accent-indigo-400" aria-label="Chọn ngày trên biểu đồ doanh thu" aria-valuetext={selectedDay ? `${dateOnly(selectedDay.date)}, ${money(selectedDay.net)}` : undefined} /></label>}
      {net === 0 && <p className="mt-4 text-xs leading-5 text-slate-500">Không có doanh thu đơn đã giao trong khoảng thời gian này. Ngày không phát sinh được hiển thị bằng 0.</p>}
      <details className="mt-5 border-t border-slate-800 pt-4"><summary className="cursor-pointer text-[11px] text-slate-400 hover:text-indigo-200">Xem bảng dữ liệu từng ngày</summary><div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-900 text-slate-500"><tr><th className="py-2 font-medium">Ngày</th><th className="py-2 text-right font-medium">Thực thu</th><th className="py-2 text-right font-medium">Giảm giá</th><th className="py-2 text-right font-medium">Lượt mua</th></tr></thead><tbody className="divide-y divide-slate-800/70 text-slate-400">{days.map((day) => <tr key={day.date}><td className="py-2">{dateOnly(day.date)}</td><td className="py-2 text-right tabular-nums">{money(day.net)}</td><td className="py-2 text-right tabular-nums">{money(day.discount)}</td><td className="py-2 text-right tabular-nums">{integer(day.purchaseCount)}</td></tr>)}</tbody></table></div></details>
    </>}
  </div>;
}

function AnalyticsLoading() {
  return <div role="status" aria-label="Đang tải báo cáo" className="space-y-4"><div className="flex items-center gap-2 text-xs text-slate-400"><LoaderCircle size={15} className="animate-spin" />Đang tổng hợp số liệu thực tế…</div><div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((index) => <div key={index} className="admin-card animate-pulse p-5"><div className="h-3 w-28 rounded bg-slate-800" /><div className="mt-7 h-7 w-36 rounded bg-slate-800" /><div className="mt-4 h-2.5 w-40 rounded bg-slate-800/60" /></div>)}</div><div aria-hidden="true" className="admin-card h-80 animate-pulse bg-slate-900/40" /></div>;
}
function dateOnly(value: string) { const normalized = value.slice(0, 10); return `${normalized.slice(8, 10)}/${normalized.slice(5, 7)}/${normalized.slice(0, 4)}`; }
function shortDate(value: string) { return `${value.slice(8, 10)}/${value.slice(5, 7)}`; }
function timestamp(value: string) { return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function compactMoney(value: number) { return new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
