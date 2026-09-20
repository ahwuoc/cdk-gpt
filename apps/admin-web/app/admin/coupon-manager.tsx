'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Info, LoaderCircle, Pencil, Plus, Power, RefreshCw, Search, TicketPercent, X } from 'lucide-react';
import type { AuthorizedRequest } from './operations-dashboard';
import { requestId } from './request-id';

interface Coupon {
  _id: string; code: string; type: 'PERCENT' | 'FIXED'; value: number; minSubtotal: number;
  maxDiscount?: number | null; startsAt?: string | null; endsAt?: string | null;
  usageLimit?: number | null; perUserLimit: number; productIds: string[];
  active: boolean; usageCount: number; createdAt: string;
}
interface CouponPage { items: Coupon[]; page: number; limit: number; total: number; totalPages: number; }
interface ProductChoice { _id: string; name: string; }
interface CouponDraft {
  code: string; type: 'PERCENT' | 'FIXED'; value: string; minSubtotal: string; maxDiscount: string;
  startsAt: string; endsAt: string; usageLimit: string; perUserLimit: string;
  productIds: string[]; restricted: boolean; active: boolean;
}

const emptyDraft = (): CouponDraft => ({ code: '', type: 'PERCENT', value: '10', minSubtotal: '0', maxDiscount: '',
  startsAt: '', endsAt: '', usageLimit: '', perUserLimit: '1', productIds: [], restricted: false, active: true });
const pageSize = 12;
const maximumProducts = 100;
const money = (value: number) => `${value.toLocaleString('vi-VN')} ₫`;
const count = (value: number) => value.toLocaleString('vi-VN');

export function CouponManager({ authorized, setMessage }: {
  authorized: AuthorizedRequest; setMessage(message: string, kind?: 'success' | 'error' | 'warning' | 'info'): void;
}) {
  const [result, setResult] = useState<CouponPage | null>(null);
  const [query, setQuery] = useState({ q: '', active: '', page: 1 });
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState<CouponDraft>(emptyDraft);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const listRequest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++listRequest.current;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams({ page: String(query.page), limit: String(pageSize) });
        if (query.q.trim()) params.set('q', query.q.trim());
        if (query.active) params.set('active', query.active);
        const response = await authorized(`/admin/coupons?${params}`, { signal: controller.signal });
        const body = await readResponse<CouponPage>(response, 'Không thể tải phiếu giảm giá.');
        if (controller.signal.aborted || listRequest.current !== request) return;
        if (query.page > Math.max(1, body.totalPages)) {
          setQuery((current) => ({ ...current, page: Math.max(1, body.totalPages) })); return;
        }
        setResult(body);
      } catch (cause) {
        if (!controller.signal.aborted && listRequest.current === request) {
          setResult(null); setError(errorText(cause, 'Không thể tải phiếu giảm giá.'));
        }
      } finally { if (!controller.signal.aborted && listRequest.current === request) setLoading(false); }
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [authorized, query, version]);

  useEffect(() => { if (formOpen) formHeading.current?.focus(); }, [formOpen, editing]);

  function openForm(coupon?: Coupon) {
    setEditing(coupon ?? null); setFormError('');
    setDraft(coupon ? {
      code: coupon.code, type: coupon.type, value: String(coupon.value), minSubtotal: String(coupon.minSubtotal),
      maxDiscount: coupon.maxDiscount == null ? '' : String(coupon.maxDiscount),
      startsAt: vietnamInputDate(coupon.startsAt), endsAt: vietnamInputDate(coupon.endsAt),
      usageLimit: coupon.usageLimit == null ? '' : String(coupon.usageLimit), perUserLimit: String(coupon.perUserLimit),
      productIds: coupon.productIds ?? [], restricted: !!coupon.productIds?.length, active: coupon.active,
    } : emptyDraft());
    setFormOpen(true);
    window.requestAnimationFrame(() => formHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    if (saving || updatingId !== null) return;
    if (draft.startsAt && draft.endsAt && draft.endsAt <= draft.startsAt) {
      setFormError('Thời gian kết thúc phải sau thời gian bắt đầu.'); return;
    }
    if (draft.restricted && draft.productIds.length === 0) {
      setFormError('Hãy chọn ít nhất một sản phẩm hoặc áp dụng cho tất cả sản phẩm.'); return;
    }
    if (draft.restricted && draft.productIds.length > maximumProducts) {
      setFormError(`Mỗi mã được áp dụng tối đa ${maximumProducts} sản phẩm.`); return;
    }
    if (editing && draft.usageLimit && Number(draft.usageLimit) < editing.usageCount) {
      setFormError(`Tổng lượt dùng không được thấp hơn ${count(editing.usageCount)} lượt đã sử dụng.`); return;
    }
    setSaving(true);
    try {
      const body = {
        ...(!editing ? { code: draft.code.trim().toUpperCase() } : {}), type: draft.type,
        value: Number(draft.value), minSubtotal: Number(draft.minSubtotal),
        maxDiscount: draft.type === 'PERCENT' && draft.maxDiscount ? Number(draft.maxDiscount) : null,
        startsAt: draft.startsAt ? new Date(`${draft.startsAt}+07:00`).toISOString() : null,
        endsAt: draft.endsAt ? new Date(`${draft.endsAt}+07:00`).toISOString() : null,
        usageLimit: draft.usageLimit ? Number(draft.usageLimit) : null, perUserLimit: Number(draft.perUserLimit),
        productIds: draft.restricted ? draft.productIds : [], active: draft.active,
      };
      const response = await authorized(`/admin/coupons${editing ? `/${editing._id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() }, body: JSON.stringify(body),
      });
      await readResponse<Coupon>(response, 'Không thể lưu phiếu giảm giá.');
      setMessage(`Đã ${editing ? 'cập nhật' : 'tạo'} mã giảm giá ${draft.code.trim().toUpperCase()}.`, 'success');
      setFormOpen(false); setEditing(null); setDraft(emptyDraft()); setVersion((current) => current + 1);
    } catch (cause) { setFormError(errorText(cause, 'Không thể lưu phiếu giảm giá.')); }
    finally { setSaving(false); }
  }

  async function toggle(coupon: Coupon) {
    if (saving || updatingId !== null) return;
    if (!window.confirm(`${coupon.active ? 'Tạm dừng' : 'Bật'} mã ${coupon.code}? ${coupon.active ? 'Khách sẽ không thể áp dụng mã cho lượt mua mới.' : 'Mã vẫn phải đáp ứng thời hạn và giới hạn sử dụng.'}`)) return;
    setUpdatingId(coupon._id);
    try {
      const response = await authorized(`/admin/coupons/${coupon._id}`, { method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() }, body: JSON.stringify({ active: !coupon.active }) });
      await readResponse<Coupon>(response, 'Không thể đổi trạng thái mã giảm giá.');
      if (editing?._id === coupon._id) {
        setEditing({ ...coupon, active: !coupon.active }); setDraft((current) => ({ ...current, active: !coupon.active }));
      }
      setMessage(`Đã ${coupon.active ? 'tạm dừng' : 'bật'} mã ${coupon.code}.`, 'success');
      setVersion((current) => current + 1);
    } catch (cause) { setMessage(errorText(cause, 'Không thể đổi trạng thái mã giảm giá.'), 'error'); }
    finally { setUpdatingId(null); }
  }

  return <section className="space-y-6" aria-label="Voucher giảm giá">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300">Tăng trưởng · Ưu đãi</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">Voucher giảm giá</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Tạo lý do để khách quay lại. Kiểm soát ưu đãi, thời hạn và số lượt dùng trong một nơi.</p></div>
      <button type="button" disabled={saving || updatingId !== null} onClick={() => openForm()} className="button-primary inline-flex items-center gap-2"><Plus size={17} />Tạo mã giảm giá</button>
    </div>

    {formOpen && <div className="admin-card overflow-hidden border-indigo-400/30">
      <div className="flex items-start justify-between gap-3 border-b border-slate-800 bg-indigo-500/5 px-5 py-4">
        <div className="flex gap-3"><span className="mt-1 text-indigo-300"><TicketPercent size={21} /></span><div>
          <h2 ref={formHeading} tabIndex={-1} className="scroll-mt-28 font-semibold text-slate-100 outline-none">{editing ? `Chỉnh sửa ${editing.code}` : 'Một ưu đãi mới'}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">Giá trị tính bằng VND. Lịch áp dụng theo giờ Việt Nam (UTC+7).</p></div></div>
        <button type="button" disabled={saving} onClick={() => setFormOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Đóng biểu mẫu giảm giá"><X size={18} /></button>
      </div>
      <form onSubmit={submit} className="p-5 sm:p-6">
        <fieldset disabled={saving || updatingId !== null} className="grid min-w-0 gap-6 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="label">Mã giảm giá</span><input className="input font-mono uppercase" autoComplete="off" value={draft.code} required minLength={3} maxLength={40} pattern={'[A-Za-z0-9][A-Za-z0-9_\\-]{2,39}'} disabled={!!editing}
                onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })} placeholder="WELCOME10" /><span className="mt-1 block text-[11px] leading-5 text-slate-500">{editing ? 'Mã không thể đổi sau khi tạo.' : '3–40 ký tự, bắt đầu bằng chữ hoặc số; có thể dùng _ và -.'}</span></label>
              <label className="block"><span className="label">Loại ưu đãi</span><select className="input" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as CouponDraft['type'] })}><option value="PERCENT">Giảm theo phần trăm (%)</option><option value="FIXED">Giảm số tiền cố định (₫)</option></select></label>
              <label className="block"><span className="label">{draft.type === 'PERCENT' ? 'Phần trăm giảm (%)' : 'Số tiền giảm (₫)'}</span><input className="input" type="number" inputMode="numeric" min="1" max={draft.type === 'PERCENT' ? 100 : Number.MAX_SAFE_INTEGER} step="1" required value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>
              <label className="block"><span className="label">Giá trị đơn tối thiểu (₫)</span><input className="input" type="number" inputMode="numeric" min="0" max={Number.MAX_SAFE_INTEGER} step="1" required value={draft.minSubtotal} onChange={(event) => setDraft({ ...draft, minSubtotal: event.target.value })} /></label>
            </div>
            {draft.type === 'PERCENT' && <label className="block"><span className="label">Giảm tối đa mỗi lượt mua (₫)</span><input className="input" type="number" inputMode="numeric" min="1" max={Number.MAX_SAFE_INTEGER} step="1" value={draft.maxDiscount} placeholder="Để trống nếu không giới hạn" onChange={(event) => setDraft({ ...draft, maxDiscount: event.target.value })} /></label>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="label">Bắt đầu · giờ Việt Nam</span><input className="input" type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /><span className="mt-1 block text-[11px] text-slate-500">Để trống: áp dụng ngay khi bật.</span></label>
              <label className="block"><span className="label">Kết thúc · giờ Việt Nam</span><input className="input" type="datetime-local" value={draft.endsAt} min={draft.startsAt || undefined} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /><span className="mt-1 block text-[11px] text-slate-500">Để trống: không có ngày hết hạn.</span></label>
              <label className="block"><span className="label">Tổng lượt dùng tối đa</span><input className="input" type="number" inputMode="numeric" min={Math.max(1, editing?.usageCount ?? 0)} max={Number.MAX_SAFE_INTEGER} step="1" value={draft.usageLimit} placeholder="Không giới hạn" onChange={(event) => setDraft({ ...draft, usageLimit: event.target.value })} /></label>
              <label className="block"><span className="label">Lượt dùng tối đa mỗi khách</span><input className="input" type="number" inputMode="numeric" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={draft.perUserLimit} onChange={(event) => setDraft({ ...draft, perUserLimit: event.target.value })} /></label>
            </div>
          </div>
          <div className="min-w-0 space-y-5">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <label className="flex items-center justify-between gap-3"><span><span className="block text-sm font-medium text-slate-200">Bật mã giảm giá</span><span className="mt-1 block text-xs leading-5 text-slate-500">Mã đang bật vẫn tuân theo lịch và giới hạn lượt dùng.</span></span><input type="checkbox" className="size-4 shrink-0 accent-indigo-400" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /></label>
            </div>
            <div><label className="block"><span className="label">Phạm vi áp dụng</span><select className="input" value={draft.restricted ? 'selected' : 'all'} onChange={(event) => setDraft({ ...draft, restricted: event.target.value === 'selected' })}><option value="all">Tất cả sản phẩm</option><option value="selected">Chỉ các sản phẩm được chọn</option></select></label>
              {draft.restricted && <ProductPicker authorized={authorized} selected={draft.productIds} disabled={saving} onChange={(productIds) => setDraft((current) => ({ ...current, productIds }))} />}
            </div>
            <div className="rounded-xl border border-indigo-400/20 bg-indigo-400/5 p-4">
              <p className="text-[10px] font-medium uppercase tracking-widest text-indigo-300">Tóm tắt ưu đãi</p>
              <p className="mt-3 break-all font-mono text-lg font-semibold text-white">{draft.code.trim() || 'MA_GIAM_GIA'}</p>
              <p className="mt-2 text-sm text-slate-300">Giảm {draft.type === 'PERCENT' ? `${draft.value || '0'}%` : money(Number(draft.value) || 0)}{draft.type === 'PERCENT' && draft.maxDiscount ? `, tối đa ${money(Number(draft.maxDiscount))}` : ''}.</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">Đơn từ {money(Number(draft.minSubtotal) || 0)} · {draft.perUserLimit || '0'} lượt/khách · {draft.restricted ? `${draft.productIds.length} sản phẩm đã chọn` : 'Tất cả sản phẩm'}.</p>
            </div>
          </div>
        </fieldset>
        {formError && <p role="alert" className="mt-5 rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200">{formError}</p>}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 pt-5"><button type="button" disabled={saving} onClick={() => setFormOpen(false)} className="button-secondary">Hủy</button><button type="submit" disabled={saving || updatingId !== null} className="button-primary inline-flex items-center gap-2">{saving && <LoaderCircle size={16} className="animate-spin" />}{saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo mã giảm giá'}</button></div>
      </form>
    </div>}

    <div className="admin-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-5">
        <div><h2 className="font-semibold text-slate-100">Danh sách ưu đãi</h2><p className="mt-1 text-xs text-slate-500">{result ? `${count(result.total)} mã theo bộ lọc` : 'Theo dõi mã và lượt sử dụng thực tế'}</p></div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
          <label className="relative min-w-0 flex-1 md:w-56"><Search size={15} className="pointer-events-none absolute left-3 top-3.5 text-slate-500" /><span className="sr-only">Tìm mã giảm giá</span><input type="search" maxLength={100} className="input !pl-9" placeholder="Tìm mã giảm giá…" value={query.q} onChange={(event) => { setLoading(true); setQuery({ ...query, q: event.target.value, page: 1 }); }} /></label>
          <label><span className="sr-only">Lọc trạng thái bật</span><select className="input" value={query.active} onChange={(event) => { setLoading(true); setQuery({ ...query, active: event.target.value, page: 1 }); }}><option value="">Tất cả trạng thái</option><option value="true">Đang bật</option><option value="false">Tạm dừng</option></select></label>
          <button type="button" disabled={loading} onClick={() => setVersion((current) => current + 1)} className="button-secondary p-3" aria-label="Làm mới phiếu giảm giá"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      {error ? <div role="alert" className="p-8 text-center"><p className="text-sm text-rose-300">{error}</p><button type="button" onClick={() => setVersion((current) => current + 1)} className="button-secondary mt-4">Thử lại</button></div>
        : loading ? <div role="status" className="flex items-center justify-center gap-2 p-16 text-sm text-slate-400"><LoaderCircle size={18} className="animate-spin" />Đang tải ưu đãi…</div>
          : !result?.items.length ? <div className="px-5 py-14 text-center"><TicketPercent size={30} className="mx-auto text-slate-600" /><h3 className="mt-4 text-sm font-medium text-slate-200">{query.q || query.active ? 'Không có mã phù hợp' : 'Ưu đãi đầu tiên bắt đầu ở đây'}</h3><p className="mt-2 text-sm text-slate-500">{query.q || query.active ? 'Thử tìm mã khác hoặc bỏ bộ lọc.' : 'Tạo mã chào mừng, tri ân khách quen hoặc chiến dịch có thời hạn.'}</p>{!query.q && !query.active && <button type="button" onClick={() => openForm()} className="button-secondary mt-5">Tạo mã đầu tiên</button>}</div>
            : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-slate-950/50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-medium">Mã / Ưu đãi</th><th className="px-5 py-3 font-medium">Trạng thái</th><th className="px-5 py-3 font-medium">Điều kiện</th><th className="px-5 py-3 font-medium">Lượt sử dụng</th><th className="px-5 py-3 font-medium">Thời hạn · VN</th><th className="px-5 py-3 text-right font-medium">Thao tác</th></tr></thead>
              <tbody className="divide-y divide-slate-800/70">{result.items.map((coupon) => {
                const state = couponState(coupon);
                return <tr key={coupon._id} className="transition hover:bg-slate-800/20"><td className="px-5 py-4"><p className="font-mono font-semibold tracking-wide text-indigo-200">{coupon.code}</p><p className="mt-1 text-xs text-slate-400">Giảm {coupon.type === 'PERCENT' ? `${coupon.value}%` : money(coupon.value)}{coupon.maxDiscount != null ? ` · tối đa ${money(coupon.maxDiscount)}` : ''}</p></td>
                  <td className="px-5 py-4"><span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-medium ${state.style}`}>{state.label}</span></td>
                  <td className="px-5 py-4"><p className="text-xs text-slate-300">Đơn từ {money(coupon.minSubtotal)}</p><p className="mt-1 text-[11px] text-slate-500">{coupon.productIds?.length ? `${coupon.productIds.length} sản phẩm` : 'Tất cả sản phẩm'}</p></td>
                  <td className="px-5 py-4"><p className="text-sm tabular-nums text-slate-200">{count(coupon.usageCount)}<span className="text-slate-500"> / {coupon.usageLimit == null ? '∞' : count(coupon.usageLimit)}</span></p><p className="mt-1 text-[11px] text-slate-500">{count(coupon.perUserLimit)} lượt/khách</p></td>
                  <td className="px-5 py-4 text-[11px] leading-5 text-slate-400"><p>{coupon.startsAt ? `Từ ${dateLabel(coupon.startsAt)}` : 'Bắt đầu ngay khi bật'}</p><p>{coupon.endsAt ? `Đến ${dateLabel(coupon.endsAt)}` : 'Không hết hạn'}</p></td>
                  <td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" disabled={saving || updatingId !== null} onClick={() => openForm(coupon)} className="button-secondary p-2" aria-label={`Sửa mã ${coupon.code}`} title="Chỉnh sửa"><Pencil size={15} /></button><button type="button" disabled={saving || updatingId !== null} onClick={() => void toggle(coupon)} className={`rounded-lg border p-2 ${coupon.active ? 'border-slate-700 text-slate-400 hover:text-amber-300' : 'border-indigo-400/30 text-indigo-300'}`} aria-label={`${coupon.active ? 'Tạm dừng' : 'Bật'} mã ${coupon.code}`} title={coupon.active ? 'Tạm dừng' : 'Bật mã'}>{updatingId === coupon._id ? <LoaderCircle size={15} className="animate-spin" /> : <Power size={15} />}</button></div></td>
                </tr>;
              })}</tbody></table></div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-5 py-4"><p className="text-xs text-slate-500">Trang {result?.page ?? query.page} / {Math.max(1, result?.totalPages ?? 1)}</p><div className="flex gap-2"><button type="button" className="button-secondary inline-flex items-center gap-1 px-3 py-2 text-xs" disabled={loading || query.page <= 1} onClick={() => { setLoading(true); setQuery({ ...query, page: query.page - 1 }); }}><ChevronLeft size={14} />Trước</button><button type="button" className="button-secondary inline-flex items-center gap-1 px-3 py-2 text-xs" disabled={loading || query.page >= (result?.totalPages ?? 0)} onClick={() => { setLoading(true); setQuery({ ...query, page: query.page + 1 }); }}>Sau<ChevronRight size={14} /></button></div></div>
    </div>
    <p className="flex items-start gap-2 text-xs leading-6 text-slate-500"><Info size={15} className="mt-1 shrink-0" />Mỗi lượt mua áp dụng một mã. Giảm giá được kiểm tra lại khi thanh toán; mã tạm dừng, hết hạn hoặc hết lượt sẽ không áp dụng cho lượt mua mới.</p>
  </section>;
}

function ProductPicker({ authorized, selected, onChange, disabled }: {
  authorized: AuthorizedRequest; selected: string[]; onChange(ids: string[]): void; disabled: boolean;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<ProductChoice[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (search.trim()) params.set('search', search.trim());
      const response = await authorized(`/admin/products?${params}`, { signal });
      const body = await readResponse<{ items: ProductChoice[]; pagination: { totalPages: number } }>(response, 'Không thể tải danh sách sản phẩm.');
      if (signal.aborted) return;
      setProducts(body.items); setTotalPages(body.pagination.totalPages);
      setNames((current) => ({ ...current, ...Object.fromEntries(body.items.map((product) => [product._id, product.name])) }));
    } catch (cause) { if (!signal.aborted) setError(errorText(cause, 'Không thể tải danh sách sản phẩm.')); }
    finally { if (!signal.aborted) setLoading(false); }
  }, [authorized, page, search]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [load, version]);

  return <div className="mt-3 rounded-xl border border-slate-800 p-3">
    <label className="block"><span className="sr-only">Tìm sản phẩm áp dụng</span><input type="search" disabled={disabled} maxLength={100} className="input text-xs" placeholder="Tìm sản phẩm…" value={search} onChange={(event) => { setLoading(true); setSearch(event.target.value); setPage(1); }} /></label>
    <p className="my-3 text-xs text-indigo-300">{selected.length} / {maximumProducts} sản phẩm đã chọn</p>
    {!!selected.length && <div className="mb-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">{selected.map((id) => <button type="button" disabled={disabled} key={id} onClick={() => onChange(selected.filter((value) => value !== id))} className="inline-flex max-w-full items-center gap-1 rounded-md border border-indigo-400/20 bg-indigo-400/10 px-2 py-1 text-[11px] text-indigo-200" aria-label={`Bỏ chọn ${names[id] ?? id}`}><span className="truncate">{names[id] ?? `Sản phẩm #${id.slice(-8)}`}</span><X size={11} className="shrink-0" /></button>)}</div>}
    {error ? <div role="alert" className="py-3 text-xs text-rose-300">{error}<button type="button" className="ml-2 underline" onClick={() => setVersion((current) => current + 1)}>Thử lại</button></div>
      : loading ? <p role="status" className="py-5 text-center text-xs text-slate-500">Đang tải sản phẩm…</p>
        : products.length ? <div className="max-h-48 space-y-1 overflow-y-auto">{products.map((product) => <label key={product._id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-slate-800/60"><input type="checkbox" className="mt-0.5 size-3.5 accent-indigo-400" disabled={disabled || (selected.length >= maximumProducts && !selected.includes(product._id))} checked={selected.includes(product._id)} onChange={(event) => onChange(event.target.checked ? [...selected, product._id] : selected.filter((id) => id !== product._id))} /><span className="text-xs text-slate-300">{product.name}</span></label>)}</div>
          : <p className="py-5 text-center text-xs text-slate-500">Không tìm thấy sản phẩm.</p>}
    <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3"><p className="text-[11px] text-slate-500">Trang {page} / {Math.max(1, totalPages)}</p><div className="flex gap-2"><button type="button" disabled={disabled || loading || page <= 1} onClick={() => { setLoading(true); setPage(page - 1); }} className="button-secondary p-1.5" aria-label="Trang sản phẩm trước"><ChevronLeft size={13} /></button><button type="button" disabled={disabled || loading || page >= totalPages} onClick={() => { setLoading(true); setPage(page + 1); }} className="button-secondary p-1.5" aria-label="Trang sản phẩm sau"><ChevronRight size={13} /></button></div></div>
  </div>;
}

function couponState(coupon: Coupon) {
  if (!coupon.active) return { label: 'Tạm dừng', style: 'border-slate-700 bg-slate-800/50 text-slate-400' };
  if (coupon.endsAt && new Date(coupon.endsAt).getTime() <= Date.now()) return { label: 'Hết hạn', style: 'border-rose-400/20 bg-rose-400/5 text-rose-300' };
  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) return { label: 'Hết lượt', style: 'border-amber-400/20 bg-amber-400/5 text-amber-300' };
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > Date.now()) return { label: 'Đã lên lịch', style: 'border-sky-400/20 bg-sky-400/5 text-sky-300' };
  return { label: 'Đang áp dụng', style: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300' };
}
function vietnamInputDate(value?: string | null) { return value ? new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16) : ''; }
function dateLabel(value: string) { return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function errorText(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback; }
async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null) as T & { message?: string | string[] } | null;
  if (!response.ok || !body) throw new Error(Array.isArray(body?.message) ? body.message.join('. ') : body?.message || fallback);
  return body;
}
