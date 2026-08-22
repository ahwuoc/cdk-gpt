'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, ChevronLeft, ChevronRight, Eye, LoaderCircle, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { ProductRecord } from './product-manager';
import { requestId } from './request-id';

type InventoryStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'DISABLED' | 'RETURNED';

interface InventoryRecord {
  id: string;
  productId: string;
  status: InventoryStatus;
  maskedPreview: Record<string, unknown>;
  importBatchId?: string | null;
  createdAt: string;
  updatedAt?: string;
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

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const query = new URLSearchParams({ page: String(filter.page), limit: String(pageSize) });
      if (filter.productId) query.set('productId', filter.productId);
      if (filter.status) query.set('status', filter.status);
      if (filter.search.trim()) query.set('search', filter.search.trim());
      const response = await authorized(`/admin/inventory?${query}`);
      const body = await readBody<InventoryPage>(response);
      if (!response.ok) throw new Error(apiMessage(body, 'Không thể tải danh sách kho.'));
      const next = normalizePage(body);
      if (next.totalPages > 0 && filter.page > next.totalPages) {
        setFilter((current) => ({ ...current, page: next.totalPages }));
        return;
      }
      setData(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải danh sách kho.');
    } finally { setBusy(false); }
  }, [authorized, filter, setMessage]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);

  async function removeItem(item: InventoryRecord) {
    if (!window.confirm('Xóa hàng này khỏi kho? Thao tác chỉ áp dụng cho hàng chưa bán/chưa giữ.')) return;
    setActionId(item.id);
    try {
      const response = await authorized(`/admin/inventory/${item.id}`, { method: 'DELETE', headers: { 'x-request-id': requestId() } });
      const body = await readBody<{ message?: string }>(response);
      if (!response.ok) throw new Error(apiMessage(body, 'Không thể xóa hàng khỏi kho.'));
      setMessage('Đã xóa hàng khỏi kho.');
      await reloadProducts(); await load();
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
      await reloadProducts(); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể xóa lô hàng.'); }
    finally { setActionId(null); }
  }

  return <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex gap-3"><span className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-300"><Boxes size={19} /></span><div><h3 className="font-semibold text-white">Hàng đang có trong kho</h3><p className="mt-1 text-xs leading-5 text-slate-400">Xem dữ liệu đã nhập, xóa một hàng hoặc xóa nhanh cả lô nhập nhầm.</p></div></div>
      <button type="button" onClick={() => void load()} disabled={busy} className="button-secondary inline-flex items-center gap-2 px-3 py-2"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Tải lại</button>
    </div>
    <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <select className="input h-11 py-2" value={filter.productId} onChange={(event) => setFilter((current) => ({ ...current, productId: event.target.value, page: 1 }))} aria-label="Lọc sản phẩm">
        <option value="">Tất cả sản phẩm</option>{products.map((product) => <option key={product._id} value={product._id}>{product.name}</option>)}
      </select>
      <select className="input h-11 py-2" value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value, page: 1 }))} aria-label="Lọc trạng thái kho">
        <option value="">Tất cả trạng thái</option><option value="AVAILABLE">Có sẵn</option><option value="RESERVED">Đang giữ</option><option value="SOLD">Đã bán</option><option value="DISABLED">Đã vô hiệu</option><option value="RETURNED">Đã hoàn</option>
      </select>
      <label className="relative md:col-span-2 xl:col-span-2"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input h-11 py-2 pl-10 font-mono text-xs" value={filter.search} onChange={(event) => setFilter((current) => ({ ...current, search: event.target.value, page: 1 }))} placeholder="Tìm theo ID hàng hoặc ID lô" /></label>
    </div>

    <div className="mt-4 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      {busy && <Loading />}
      {!busy && data.items.map((item) => <InventoryRow key={item.id} item={item} product={products.find((product) => product._id === item.productId)}
        pending={actionId === item.id || actionId === `batch:${item.importBatchId}`} onRemove={() => void removeItem(item)}
        onRemoveBatch={item.importBatchId ? () => void removeBatch(item.importBatchId!) : undefined} onReveal={() => void onReveal(item.id)} />)}
      {!busy && data.items.length === 0 && <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500"><Boxes className="text-slate-600" /><p>Chưa có hàng phù hợp trong kho.</p></div>}
    </div>
    <Pagination data={data} onPage={(page) => setFilter((current) => ({ ...current, page }))} />
  </section>;
}

function InventoryRow({ item, product, pending, onRemove, onRemoveBatch, onReveal }: { item: InventoryRecord; product?: ProductRecord; pending: boolean; onRemove(): void; onRemoveBatch?: () => void; onReveal(): void }) {
  const removable = item.status === 'AVAILABLE';
  return <article className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><Status value={item.status} /><span className="text-sm font-medium text-slate-100">{product?.name ?? 'Sản phẩm đã xóa'}</span></div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><code title={item.id}>ID {shortId(item.id)}</code>{item.importBatchId && <code title={item.importBatchId}>Lô {shortId(item.importBatchId)}</code>}<span>{dateTime(item.createdAt)}</span></div>
      <Preview value={item.maskedPreview} />
    </div>
    <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
      <button type="button" disabled={pending} onClick={onReveal} className="button-secondary inline-flex items-center justify-center gap-2 px-3 py-2"><Eye size={14} />Xem</button>
      {removable && <button type="button" disabled={pending} onClick={onRemove} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-900/60 px-3 py-2 text-sm font-medium text-rose-300 transition hover:bg-rose-950/30 disabled:opacity-50"><Trash2 size={14} />Xóa</button>}
      {removable && onRemoveBatch && <button type="button" disabled={pending} onClick={onRemoveBatch} className="button-secondary col-span-2 px-3 py-2 text-xs">Xóa cả lô</button>}
      {!removable && <span className="col-span-2 self-center text-center text-xs text-slate-500 sm:max-w-28">Hàng đã bán/đang giữ không thể xóa</span>}
    </div>
  </article>;
}

function Preview({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value ?? {});
  if (!entries.length) return <p className="mt-2 text-xs text-slate-600">Không có dữ liệu xem trước.</p>;
  return <div className="mt-2 flex flex-wrap gap-1.5">{entries.slice(0, 4).map(([key, item]) => <span key={key} className="max-w-full truncate rounded-md bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-400">{key}: {String(item ?? '—')}</span>)}{entries.length > 4 && <span className="rounded-md bg-slate-900 px-2 py-1 text-[11px] text-slate-500">+{entries.length - 4}</span>}</div>;
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
function normalizePage(value: Partial<InventoryPage>): InventoryPage { return { items: Array.isArray(value.items) ? value.items : [], page: Number(value.page) || 1, limit: Number(value.limit) || pageSize, total: Number(value.total) || 0, totalPages: Number(value.totalPages) || 0 }; }
async function readBody<T>(response: Response): Promise<T> { const text = await response.text(); if (!text) return {} as T; try { return JSON.parse(text) as T; } catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` } as T; } }
function apiMessage(value: unknown, fallback: string) { if (!value || typeof value !== 'object' || !('message' in value)) return fallback; const message = (value as { message?: unknown }).message; return Array.isArray(message) ? message.filter((item): item is string => typeof item === 'string').join('. ') || fallback : typeof message === 'string' ? message : fallback; }
