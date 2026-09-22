'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Boxes, ChevronLeft, ChevronRight, Eye, Filter, LoaderCircle, PackageCheck, RefreshCw, Search, Trash2 } from 'lucide-react';
import { normalizeInventorySearchTerms } from '@store/shared';
import type { ProductRecord } from './product-manager';
import { requestId } from './request-id';

type InventoryStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'DISABLED' | 'RETURNED';

interface InventoryRecord {
  id: string;
  productId: string;
  productName?: string;
  status: InventoryStatus;
  maskedPreview: Record<string, unknown>;
  importBatchId?: string | null;
  createdAt: string;
  updatedAt?: string;
  sale?: {
    soldAt?: string;
    order?: { id: string; orderCode: string; unitPrice: number; totalAmount: number; paymentMethod: string; createdAt: string };
    buyer?: { id: string; telegramId: string; username?: string; displayName?: string };
  };
}

interface InventoryPage {
  items: InventoryRecord[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const pageSize = 20;
const emptyPage: InventoryPage = { items: [], page: 1, limit: pageSize, total: 0, totalPages: 0 };
const statuses: Array<{ value: '' | InventoryStatus; label: string }> = [
  { value: '', label: 'Tất cả' },
  { value: 'AVAILABLE', label: 'Có sẵn' },
  { value: 'RESERVED', label: 'Đang giữ' },
  { value: 'SOLD', label: 'Đã bán' },
  { value: 'DISABLED', label: 'Vô hiệu' },
  { value: 'RETURNED', label: 'Đã hoàn' },
];

export function InventoryManager({ products, authorized, reloadProducts, onReveal, setMessage, refreshKey }: {
  products: ProductRecord[];
  authorized(path: string, init?: RequestInit): Promise<Response>;
  reloadProducts(): Promise<void>;
  onReveal(id: string): Promise<void>;
  setMessage(message: string): void;
  refreshKey: number;
}) {
  const [data, setData] = useState<InventoryPage>(emptyPage);
  const [busy, setBusy] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [filter, setFilter] = useState({ productId: '', status: '', search: '', page: 1 });
  const [searchDraft, setSearchDraft] = useState('');
  const activeRequest = useRef<AbortController | null>(null);
  const refreshCurrentFilter = useRef<(() => Promise<void>) | null>(null);
  const activeProduct = products.find((product) => product._id === filter.productId);
  const pageStats = pageStatusCounts(data.items);
  const stats = activeProduct ? {
    available: activeProduct.availableStock, reserved: activeProduct.reservedStock, sold: activeProduct.soldStock,
  } : { available: pageStats.AVAILABLE ?? 0, reserved: pageStats.RESERVED ?? 0, sold: pageStats.SOLD ?? 0 };

  const load = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    try {
      const query = new URLSearchParams({ page: String(filter.page), limit: String(pageSize) });
      if (filter.productId) query.set('productId', filter.productId);
      if (filter.status) query.set('status', filter.status);
      const search = filter.search.trim();
      const response = search
        ? await authorized('/admin/inventory/search', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...Object.fromEntries(query), search }), signal: controller.signal })
        : await authorized(`/admin/inventory?${query}`, { signal: controller.signal });
      const body = await readBody<InventoryPage>(response);
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(apiMessage(body, 'Không thể tải danh sách kho.'));
      const next = normalizePage(body);
      if (next.totalPages > 0 && filter.page > next.totalPages) {
        setFilter((current) => ({ ...current, page: next.totalPages }));
        return;
      }
      setData(next);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Không thể tải danh sách kho.');
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setBusy(false); }
    }
  }, [authorized, filter, setMessage]);

  useEffect(() => {
    refreshCurrentFilter.current = load;
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      activeRequest.current?.abort();
      activeRequest.current = null;
      refreshCurrentFilter.current = null;
    };
  }, [load, refreshKey]);

  function applySearch() {
    try {
      const search = normalizeInventorySearchTerms(searchDraft).join('\n');
      setFilter((current) => ({ ...current, search, page: 1 }));
    } catch (error) {
      setMessage(`Không thể tìm kiếm: ${error instanceof Error ? error.message : 'Từ khóa tìm kiếm không hợp lệ.'}`);
    }
  }

  function clearFilters() {
    setSearchDraft('');
    setFilter({ productId: '', status: '', search: '', page: 1 });
  }

  async function removeItem(item: InventoryRecord) {
    if (!window.confirm('Xóa hàng này khỏi kho? Thao tác chỉ áp dụng cho hàng chưa bán/chưa giữ.')) return;
    setActionId(item.id);
    try {
      const response = await authorized(`/admin/inventory/${item.id}`, { method: 'DELETE', headers: { 'x-request-id': requestId() } });
      const body = await readBody<{ message?: string }>(response);
      if (!response.ok) throw new Error(apiMessage(body, 'Không thể xóa hàng khỏi kho.'));
      setMessage('Đã xóa hàng khỏi kho.');
      await reloadProducts(); await refreshCurrentFilter.current?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể xóa hàng khỏi kho.'); }
    finally { setActionId(null); }
  }

  async function removeBatch(batchId: string) {
    if (!window.confirm('Xóa toàn bộ hàng CHƯA BÁN trong lô này? Hàng đã bán hoặc đang giữ sẽ được bảo toàn.')) return;
    setActionId(`batch:${batchId}`);
    try {
      const response = await authorized(`/admin/inventory/batches/${batchId}`, { method: 'DELETE', headers: { 'x-request-id': requestId() } });
      const body = await readBody<{ removedCount?: number; protectedCount?: number; message?: string }>(response);
      if (!response.ok) throw new Error(apiMessage(body, 'Không thể xóa lô hàng.'));
      setMessage(`Đã xóa ${body.removedCount ?? 0} hàng trong lô${body.protectedCount ? `; giữ lại ${body.protectedCount} hàng đã bán/đang xử lý` : ''}.`);
      await reloadProducts(); await refreshCurrentFilter.current?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể xóa lô hàng.'); }
    finally { setActionId(null); }
  }

  return <section className="@container min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex gap-3"><span className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-300"><Boxes size={19} /></span><div><h3 className="font-semibold text-white">Theo dõi kho hàng</h3><p className="mt-1 text-xs leading-5 text-slate-400">Lọc theo sản phẩm, trạng thái, lô nhập và xem nhanh dữ liệu từng dòng.</p></div></div>
      <button type="button" onClick={() => void load()} disabled={busy} className="button-secondary inline-flex items-center gap-2 px-3 py-2"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Tải lại</button>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label={activeProduct ? 'Có sẵn sản phẩm này' : 'Có sẵn trang này'} value={stats.available} tone="emerald" />
      <MetricCard label={activeProduct ? 'Đang giữ sản phẩm này' : 'Đang giữ trang này'} value={stats.reserved} tone="amber" />
      <MetricCard label={activeProduct ? 'Đã bán sản phẩm này' : 'Đã bán trang này'} value={stats.sold} tone="sky" />
      <MetricCard label="Tổng kết quả lọc" value={data.total} tone="slate" />
    </div>

    <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select className="input h-11 py-2 sm:w-[260px]" value={filter.productId} onChange={(event) => setFilter((current) => ({ ...current, productId: event.target.value, page: 1 }))} aria-label="Lọc sản phẩm">
          <option value="">Tất cả sản phẩm</option>{products.map((product) => <option key={product._id} value={product._id}>{product.name}</option>)}
        </select>
        <button type="button" className="button-secondary inline-flex items-center justify-center gap-2 px-3 py-2" onClick={clearFilters}><Filter size={15} />Xóa lọc</button>
      </div>
      <label className="mt-3 block">
        <span className="mb-2 block text-xs font-medium text-slate-300">Tìm kiếm nhiều dòng</span>
        <textarea className="input min-h-28 resize-y font-mono text-xs leading-6" rows={4}
          value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); applySearch(); } }}
          placeholder={'Dán danh sách cần tìm, mỗi dòng một email hoặc ID:\nuser1@example.com\nuser2@example.com\nuser3@example.com'}
          aria-label="Tìm kiếm kho hàng" aria-describedby="inventory-search-help" spellCheck={false} autoCapitalize="none" />
      </label>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p id="inventory-search-help" className="min-w-0 flex-1 basis-64 text-[11px] leading-5 text-slate-500">Dán tối đa 100 dòng. Với dạng <code>email----password----2fa</code>, hệ thống tự lấy email để tìm. Nhấn Enter để xuống dòng, Ctrl/⌘ + Enter để tìm.</p>
        <button type="button" className="button-primary inline-flex items-center justify-center gap-2 px-4 py-2.5" onClick={applySearch} disabled={busy}><Search size={15} />Tìm kiếm</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {statuses.map((status) => <button key={status.value || 'all'} type="button"
          onClick={() => setFilter((current) => ({ ...current, status: status.value, page: 1 }))}
          className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${filter.status === status.value
            ? 'border-indigo-400 bg-indigo-500/20 text-indigo-100'
            : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-100'}`}>
          {status.label}{status.value && <span className="ml-1 text-slate-500">({pageStats[status.value] ?? 0})</span>}
        </button>)}
      </div>
    </div>

    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      <div className="hidden border-b border-slate-800 bg-slate-950/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 @[1050px]:grid @[1050px]:grid-cols-[minmax(200px,0.9fr)_minmax(230px,1fr)_minmax(220px,0.95fr)_130px_170px]">
        <span>Sản phẩm</span><span>Dữ liệu xem trước</span><span>Bán cho / giá bán</span><span>Lô nhập</span><span className="text-right">Thao tác</span>
      </div>
      <div className="max-h-[min(68vh,720px)] divide-y divide-slate-800 overflow-x-hidden overflow-y-auto overscroll-contain">
      {busy && <Loading />}
      {!busy && data.items.map((item) => <InventoryRow key={item.id} item={item} product={products.find((product) => product._id === item.productId)}
        pending={actionId === item.id || actionId === `batch:${item.importBatchId}`} onRemove={() => void removeItem(item)}
        onRemoveBatch={item.importBatchId ? () => void removeBatch(item.importBatchId!) : undefined} onReveal={() => void onReveal(item.id)} />)}
      {!busy && data.items.length === 0 && <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500"><Boxes className="text-slate-600" /><p>Chưa có hàng phù hợp trong kho.</p></div>}
      </div>
    </div>
    <Pagination data={data} onPage={(page) => setFilter((current) => ({ ...current, page }))} />
  </section>;
}

function InventoryRow({ item, product, pending, onRemove, onRemoveBatch, onReveal }: { item: InventoryRecord; product?: ProductRecord; pending: boolean; onRemove(): void; onRemoveBatch?: () => void; onReveal(): void }) {
  const removable = item.status === 'AVAILABLE';
  const productName = item.productName ?? product?.name ?? 'Sản phẩm đã xóa';
  return <article className="grid gap-3 p-4 transition hover:bg-slate-900/65 @[1050px]:grid-cols-[minmax(200px,0.9fr)_minmax(230px,1fr)_minmax(220px,0.95fr)_130px_170px] @[1050px]:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><Status value={item.status} /><span className="truncate text-sm font-medium text-slate-100">{productName}</span></div>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><PackageCheck size={14} /><code title={item.id}>ID {shortId(item.id)}</code></div>
      <p className="mt-1 text-xs text-slate-600">{dateTime(item.createdAt)}</p>
    </div>
    <div className="min-w-0">
      <Preview value={item.maskedPreview} />
    </div>
    <SaleInfo item={item} />
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Lô nhập</p>
      {item.importBatchId ? <code className="mt-1 block truncate text-xs text-slate-400" title={item.importBatchId}>{shortId(item.importBatchId)}</code> : <span className="mt-1 block text-xs text-slate-600">Không có lô</span>}
    </div>
    <div className="grid gap-2 sm:grid-cols-3 @[1050px]:grid-cols-1">
      <button type="button" disabled={pending} onClick={onReveal} className="button-secondary inline-flex w-full items-center justify-center gap-2 px-3 py-2"><Eye size={14} />Xem</button>
      <button type="button" disabled={pending || !removable} onClick={onRemove} title={removable ? 'Xóa riêng dòng kho này' : 'Chỉ xóa được hàng đang có sẵn'} className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-55 ${removable ? 'border-rose-900/60 text-rose-300 hover:bg-rose-950/30' : 'border-slate-800 text-slate-600'}`}><Trash2 size={14} />Xóa</button>
      {onRemoveBatch && <button type="button" disabled={pending || !removable} onClick={onRemoveBatch} title={removable ? 'Xóa các hàng chưa bán trong cùng lô nhập' : 'Lô có hàng đã bán/đang giữ sẽ được bảo toàn'} className="button-secondary w-full px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-55">Xóa cả lô</button>}
      {!removable && <span className="text-center text-[11px] leading-4 text-slate-500 sm:col-span-3 @[1050px]:col-span-1">Đã bán/đang giữ nên không cho xóa.</span>}
    </div>
  </article>;
}

function SaleInfo({ item }: { item: InventoryRecord }) {
  const { order, buyer, soldAt } = item.sale ?? {};
  if (!order && !buyer && !soldAt) return <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-600">
    {item.status === 'SOLD' ? 'Chưa có thông tin giao dịch cũ' : 'Chưa bán'}
  </div>;
  const buyerIdentity = buyer?.username ? `@${buyer.username}` : buyer?.telegramId ? `ID ${buyer.telegramId}` : 'Không rõ người mua';
  return <div className="min-w-0 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2">
    <p className="text-xs font-semibold text-emerald-300">{order ? `Đã bán ${money(order.unitPrice)}` : 'Đã bán'}</p>
    {buyer && <div className="mt-1 min-w-0 text-xs text-slate-300">
      <p className="truncate font-medium text-sky-200" title={buyerIdentity}>{buyerIdentity}</p>
      {buyer.displayName && <p className="mt-0.5 truncate text-[11px] text-slate-400" title={buyer.displayName}>{buyer.displayName}</p>}
      {buyer.username && <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">ID {buyer.telegramId}</p>}
    </div>}
    {order && <code className="mt-1.5 block truncate text-[11px] text-indigo-300" title={order.orderCode}>{order.orderCode}</code>}
    {soldAt && <p className="mt-1 text-[10px] text-slate-600">{dateTime(soldAt)}</p>}
  </div>;
}

function Preview({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value ?? {});
  if (!entries.length) return <p className="mt-2 text-xs text-slate-600">Không có dữ liệu xem trước.</p>;
  return <div className="grid gap-1.5 sm:grid-cols-2">{entries.slice(0, 6).map(([key, item]) => <div key={key} className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/70 px-2 py-1.5">
    <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-600">{key}</p>
    <p className="truncate font-mono text-[11px] text-slate-300" title={String(item ?? '—')}>{String(item ?? '—')}</p>
  </div>)}{entries.length > 6 && <span className="rounded-lg bg-slate-900 px-2 py-1.5 text-[11px] text-slate-500">+{entries.length - 6} trường</span>}</div>;
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'sky' | 'slate' }) {
  const styles = {
    emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    sky: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
    slate: 'text-slate-200 bg-slate-950/70 border-slate-800',
  }[tone];
  return <div className={`rounded-2xl border p-4 ${styles}`}><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString('vi-VN')}</p></div>;
}

function Status({ value }: { value: InventoryStatus }) {
  const styles: Record<InventoryStatus, [string, string]> = { AVAILABLE: ['Có sẵn', 'bg-emerald-500/15 text-emerald-300'], RESERVED: ['Đang giữ', 'bg-amber-500/15 text-amber-300'], SOLD: ['Đã bán', 'bg-sky-500/15 text-sky-300'], DISABLED: ['Vô hiệu', 'bg-slate-500/15 text-slate-300'], RETURNED: ['Đã hoàn', 'bg-violet-500/15 text-violet-300'] };
  const [label, className] = styles[value] ?? [value, 'bg-slate-500/15 text-slate-300'];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>{label}</span>;
}

function Pagination({ data, onPage }: { data: InventoryPage; onPage(page: number): void }) {
  if (!data.total && !data.totalPages) return null;
  const totalPages = Math.max(data.totalPages, 1);
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-slate-500">Hiển thị <span className="text-slate-300">{data.total ? (data.page - 1) * data.limit + 1 : 0}–{Math.min(data.page * data.limit, data.total)}</span> / {data.total}</p><div className="flex items-center gap-2"><button type="button" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} className="button-secondary inline-flex items-center gap-1 px-3 py-2"><ChevronLeft size={15} />Trước</button><span className="min-w-16 text-center text-xs text-slate-400">{data.page}/{totalPages}</span><button type="button" disabled={data.page >= totalPages} onClick={() => onPage(data.page + 1)} className="button-secondary inline-flex items-center gap-1 px-3 py-2">Sau<ChevronRight size={15} /></button></div></div>;
}

function Loading() { return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-400"><LoaderCircle size={18} className="animate-spin" />Đang tải kho…</div>; }
function shortId(value: string) { return value.length > 13 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
function money(value: number) { return Number.isFinite(value) ? `${Math.trunc(value).toLocaleString('vi-VN')} đ` : '—'; }
function normalizePage(value: Partial<InventoryPage>): InventoryPage { return { items: Array.isArray(value.items) ? value.items : [], page: Number(value.page) || 1, limit: Number(value.limit) || pageSize, total: Number(value.total) || 0, totalPages: Number(value.totalPages) || 0 }; }
function pageStatusCounts(items: InventoryRecord[]) {
  return items.reduce<Partial<Record<InventoryStatus, number>>>((sum, item) => {
    sum[item.status] = (sum[item.status] ?? 0) + 1;
    return sum;
  }, {});
}
async function readBody<T>(response: Response): Promise<T> { const text = await response.text(); if (!text) return {} as T; try { return JSON.parse(text) as T; } catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` } as T; } }
function apiMessage(value: unknown, fallback: string) { if (!value || typeof value !== 'object' || !('message' in value)) return fallback; const message = (value as { message?: unknown }).message; return Array.isArray(message) ? message.filter((item): item is string => typeof item === 'string').join('. ') || fallback : typeof message === 'string' ? message : fallback; }
