'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, LoaderCircle, MessageCircle, MessageSquareWarning, RefreshCw, Search, Send } from 'lucide-react';
import type { AuthorizedRequest } from './operations-dashboard';
import { requestId } from './request-id';

interface PageResult<T> { items: T[]; page: number; limit: number; total: number; totalPages: number; }
interface ReportRecord {
  id: string; requestCode: string; category: string; reason: string; evidenceUrls: string[]; status: string;
  resolutionNote?: string | null; reviewedAt?: string | null; createdAt: string; updatedAt: string;
  order?: { id: string; orderCode: string; status: string; deliveryStatus: string; totalAmount: number; createdAt: string } | null;
  user?: { id: string; telegramId: string; username?: string | null; displayName?: string | null } | null;
  product?: { id: string; name: string; slug: string } | null;
}
interface Editing { id: string; status: string; originalStatus: string; resolutionNote: string; }
interface ChatMessage {
  id: string; direction: 'USER_TO_ADMIN' | 'ADMIN_TO_USER'; body: string; status: string;
  errorCode?: string | null; createdAt: string;
}
interface ChatThread { reportId: string; requestCode: string; items: ChatMessage[]; }

const pageSize = 15;
const statuses = ['PENDING', 'REVIEWING', 'RESOLVED', 'REJECTED'];
const categories = ['NO_DELIVERY', 'INVALID_CREDENTIALS', 'PRODUCT_MISMATCH', 'WARRANTY', 'OTHER'];
const terminalStatuses = new Set(['RESOLVED', 'REJECTED']);

export function ComplaintManager({ authorized, setMessage }: {
  authorized: AuthorizedRequest; setMessage(message: string): void;
}) {
  const [data, setData] = useState<PageResult<ReportRecord>>({ items: [], page: 1, limit: pageSize, total: 0, totalPages: 0 });
  const [query, setQuery] = useState({ search: '', status: '', category: '', from: '', to: '', page: 1 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [chat, setChat] = useState<ChatThread | null>(null);
  const [chatBody, setChatBody] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const activeChatReport = useRef<string | null>(null);

  const load = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    try {
      const response = await authorized(`/admin/order-reports?${queryString({ ...query, limit: pageSize })}`,
        { signal: controller.signal });
      const body = await readBody<PageResult<ReportRecord>>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể tải danh sách khiếu nại.'));
      if (!controller.signal.aborted) setData(normalizePage(body));
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        setMessage(error instanceof Error ? error.message : 'Không thể tải danh sách khiếu nại.');
      }
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setLoading(false); }
    }
  }, [authorized, query, setMessage]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 350);
    return () => { window.clearTimeout(timer); activeRequest.current?.abort(); };
  }, [load]);

  const loadChat = useCallback(async (reportId: string, silent = false) => {
    if (!silent) setChatLoading(true);
    try {
      const response = await authorized(`/admin/order-reports/${reportId}/messages`);
      const body = await readBody<ChatThread & { message?: string | string[] }>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể tải hội thoại khiếu nại.'));
      if (activeChatReport.current === reportId) setChat({ reportId: body.reportId, requestCode: body.requestCode,
        items: Array.isArray(body.items) ? body.items : [] });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tải hội thoại khiếu nại.'); }
    finally { if (!silent) setChatLoading(false); }
  }, [authorized, setMessage]);

  useEffect(() => {
    if (!chat?.reportId) return;
    const reportId = chat.reportId;
    const timer = window.setInterval(() => void loadChat(reportId, true), 10_000);
    return () => window.clearInterval(timer);
  }, [chat?.reportId, loadChat]);

  async function toggleChat(reportId: string) {
    if (chat?.reportId === reportId) { activeChatReport.current = null; setChat(null); setChatBody(''); return; }
    activeChatReport.current = reportId; setChat(null); setChatBody(''); await loadChat(reportId);
  }

  async function sendChatReply() {
    if (!chat || !chatBody.trim()) return;
    setChatSending(true);
    try {
      const response = await authorized(`/admin/order-reports/${chat.reportId}/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify({ body: chatBody.trim() }),
      });
      const body = await readBody<{ message?: string | string[] }>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể gửi phản hồi.'));
      setChatBody(''); setMessage('Đã gửi phản hồi khiếu nại qua Telegram.');
      await Promise.all([loadChat(chat.reportId), load()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể gửi phản hồi.'); }
    finally { setChatSending(false); }
  }

  async function save() {
    if (!editing) return;
    if (editing.status === editing.originalStatus) {
      setMessage('Hãy chọn một trạng thái xử lý mới trước khi lưu.'); return;
    }
    if (terminalStatuses.has(editing.status) && !editing.resolutionNote.trim()) {
      setMessage('Hãy nhập ghi chú xử lý trước khi kết thúc khiếu nại.'); return;
    }
    setSaving(true);
    try {
      const response = await authorized(`/admin/order-reports/${editing.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify({ status: editing.status, resolutionNote: editing.resolutionNote.trim() }),
      });
      const body = await readBody<{ notificationSent?: boolean; message?: string | string[] }>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể cập nhật khiếu nại.'));
      setMessage(body.notificationSent
        ? 'Đã cập nhật khiếu nại và thông báo kết quả cho khách qua Telegram.'
        : 'Đã lưu kết quả, nhưng chưa gửi được thông báo Telegram cho khách.');
      setEditing(null); await load();
      if (chat?.reportId === editing.id) await loadChat(editing.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể cập nhật khiếu nại.'); }
    finally { setSaving(false); }
  }

  return <section className="space-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex gap-3"><span className="rounded-2xl bg-rose-500/10 p-3 text-rose-300"><MessageSquareWarning /></span><div>
        <p className="text-sm font-medium text-rose-300">Chăm sóc khách hàng</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Báo cáo & khiếu nại đơn hàng</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Tiếp nhận báo lỗi từ Telegram, kiểm tra đơn hàng và lưu lại kết quả xử lý.</p>
      </div></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="button-secondary inline-flex items-center justify-center gap-2 px-3 py-2.5"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Làm mới</button>
    </div>

    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-5">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        <label className="relative md:col-span-2"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input h-11 py-2 pl-10" value={query.search} onChange={(event) => setQuery((current) => ({ ...current, search: event.target.value, page: 1 }))} placeholder="Mã khiếu nại, mã đơn, khách hoặc sản phẩm" /></label>
        <select className="input h-11 py-2" value={query.status} onChange={(event) => setQuery((current) => ({ ...current, status: event.target.value, page: 1 }))}><option value="">Tất cả trạng thái</option>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
        <select className="input h-11 py-2" value={query.category} onChange={(event) => setQuery((current) => ({ ...current, category: event.target.value, page: 1 }))}><option value="">Tất cả vấn đề</option>{categories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select>
        <DateField label="Từ ngày" value={query.from} onChange={(from) => setQuery((current) => ({ ...current, from, page: 1 }))} />
        <DateField label="Đến ngày" value={query.to} onChange={(to) => setQuery((current) => ({ ...current, to, page: 1 }))} />
      </div>

      <div className="mt-4 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
        {data.items.map((report) => <article key={report.id} className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><code className="text-xs font-semibold text-indigo-200">{report.requestCode}</code><StatusBadge value={report.status} /><span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{categoryLabel(report.category)}</span></div>
              <p className="mt-2 text-sm font-medium text-slate-100">{report.product?.name ?? 'Sản phẩm đã xóa'} · {report.order?.orderCode ?? 'Đơn đã xóa'}</p>
              <p className="mt-1 text-xs text-slate-500">{person(report.user)} · {dateTime(report.createdAt)} · {money(report.order?.totalAmount)}</p>
              <p className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm leading-6 text-slate-300">{report.reason}</p>
              {report.resolutionNote && <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-emerald-300">Kết quả xử lý</p><p className="mt-1 whitespace-pre-wrap text-sm text-emerald-100">{report.resolutionNote}</p></div>}
              {report.user?.id && <div className="mt-3 flex flex-wrap gap-2 text-xs"><a className="button-secondary px-2.5 py-1.5" href={`/admin?view=orders&userId=${report.user.id}`}>Lịch sử đơn</a><a className="button-secondary px-2.5 py-1.5" href={`/admin?view=ledger&userId=${report.user.id}`}>Sổ ví khách</a></div>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => void toggleChat(report.id)} className="button-secondary inline-flex items-center gap-2 px-3 py-2"><MessageCircle size={15} />{chat?.reportId === report.id ? 'Đóng chat' : 'Hội thoại'}</button>
              <button type="button" onClick={() => setEditing(editing?.id === report.id ? null : { id: report.id, status: report.status, originalStatus: report.status, resolutionNote: report.resolutionNote ?? '' })} className="button-secondary px-3 py-2">{editing?.id === report.id ? 'Đóng xử lý' : 'Xử lý'}</button>
            </div>
          </div>
          {chat?.reportId === report.id && <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-sky-100">Trao đổi với {person(report.user)}</p><p className="mt-1 text-xs text-slate-500">Khách bấm “Trả lời shop” trong Telegram để nhắn lại đúng khiếu nại này.</p></div>
              <button type="button" className="button-secondary p-2" onClick={() => void loadChat(report.id)} disabled={chatLoading} aria-label="Làm mới hội thoại"><RefreshCw size={15} className={chatLoading ? 'animate-spin' : ''} /></button></div>
            <div className="mt-4 max-h-96 space-y-2 overflow-auto rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              {chat.items.map((message) => <div key={message.id} className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${message.direction === 'ADMIN_TO_USER' ? 'ml-auto bg-indigo-600/80 text-white' : 'bg-slate-800 text-slate-100'}`}>
                <p className="whitespace-pre-wrap break-words leading-6">{message.body}</p>
                <p className="mt-1 text-[10px] opacity-60">{dateTime(message.createdAt)} · {messageStatusLabel(message.status)}</p>
              </div>)}
              {!chatLoading && chat.items.length === 0 && <p className="py-10 text-center text-sm text-slate-500">Chưa có nội dung trao đổi.</p>}
              {chatLoading && <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin" />Đang tải hội thoại…</p>}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row"><textarea className="input min-h-24 flex-1" maxLength={4_000} value={chatBody} onChange={(event) => setChatBody(event.target.value)} placeholder="Nhập phản hồi cho khách…" />
              <button type="button" className="button-primary inline-flex min-w-32 items-center justify-center gap-2 px-4" disabled={chatSending || !chatBody.trim()} onClick={() => void sendChatReply()}><Send size={16} />{chatSending ? 'Đang gửi…' : 'Gửi'}</button></div>
          </div>}
          {editing?.id === report.id && <div className="mt-4 grid gap-3 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 lg:grid-cols-[240px_minmax(0,1fr)_auto] lg:items-end">
            <label><span className="label">Trạng thái</span><select className="input" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })}>{!statuses.includes(editing.status) && <option value={editing.status}>{statusLabel(editing.status)} (trạng thái cũ)</option>}{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
            <label><span className="label">Ghi chú xử lý</span><textarea className="input min-h-24" maxLength={5_000} value={editing.resolutionNote} onChange={(event) => setEditing({ ...editing, resolutionNote: event.target.value })} placeholder="Ví dụ: Đã kiểm tra và gửi tài khoản thay thế cho khách…" /></label>
            <button type="button" onClick={() => void save()} disabled={saving} className="button-primary h-11 px-5">{saving ? 'Đang lưu…' : 'Lưu xử lý'}</button>
          </div>}
        </article>)}
        {loading && <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-slate-400"><LoaderCircle size={18} className="animate-spin" />Đang tải khiếu nại…</div>}
        {!loading && data.items.length === 0 && <div className="flex min-h-44 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-slate-500"><MessageSquareWarning className="text-slate-600" />Không tìm thấy khiếu nại phù hợp.</div>}
      </div>
      <Pagination data={data} onPage={(page) => setQuery((current) => ({ ...current, page }))} />
    </div>
  </section>;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) { return <label className="relative"><CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input h-11 py-2 pl-9" type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} /></label>; }
function Pagination<T>({ data, onPage }: { data: PageResult<T>; onPage(page: number): void }) { if (!data.totalPages) return null; return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-slate-500">Hiển thị {(data.page - 1) * data.limit + 1}–{Math.min(data.page * data.limit, data.total)} / {data.total}</p><div className="flex items-center gap-2"><button disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} className="button-secondary inline-flex items-center gap-1 px-3 py-2"><ChevronLeft size={15} />Trước</button><span className="min-w-20 text-center text-xs text-slate-400">{data.page}/{data.totalPages}</span><button disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)} className="button-secondary inline-flex items-center gap-1 px-3 py-2">Sau<ChevronRight size={15} /></button></div></div>; }
function StatusBadge({ value }: { value: string }) { const color = value === 'PENDING' ? 'bg-amber-500/15 text-amber-300' : value === 'REVIEWING' ? 'bg-sky-500/15 text-sky-300' : value === 'REJECTED' ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'; return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>{statusLabel(value)}</span>; }
function statusLabel(value: string) { return ({ PENDING: 'Chờ xử lý', REVIEWING: 'Đang kiểm tra', RESOLVED: 'Đã giải quyết', APPROVED: 'Đã chấp nhận', REJECTED: 'Đã từ chối', REPLACED: 'Đã thay thế', REFUNDED: 'Đã hoàn tiền' } as Record<string, string>)[value] ?? value; }
function categoryLabel(value: string) { return ({ NO_DELIVERY: 'Chưa nhận được hàng', INVALID_CREDENTIALS: 'Không đăng nhập được', PRODUCT_MISMATCH: 'Không đúng mô tả', WARRANTY: 'Yêu cầu bảo hành', OTHER: 'Vấn đề khác' } as Record<string, string>)[value] ?? value; }
function messageStatusLabel(value: string) { return ({ RECEIVED: 'Khách gửi', PENDING: 'Đang chờ', SENDING: 'Đang gửi', SENT: 'Đã gửi', FAILED: 'Gửi lỗi' } as Record<string, string>)[value] ?? value; }
function person(user?: ReportRecord['user']) {
  if (!user) return 'Khách đã xóa';
  const handle = user.username ? `@${user.username.replace(/^@+/, '')}` : '';
  return [user.displayName, handle].filter(Boolean).join(' · ') || (user.telegramId ? `Telegram ${user.telegramId}` : 'Khách hàng');
}
function dateTime(value?: string | null) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
function money(value?: number) { return value === undefined ? '—' : `${new Intl.NumberFormat('vi-VN').format(value)} đ`; }
function queryString(input: Record<string, string | number>) { const query = new URLSearchParams(); for (const [key, value] of Object.entries(input)) if (value !== '') query.set(key, String(value)); return query.toString(); }
function normalizePage<T>(body: PageResult<T>): PageResult<T> { return { items: Array.isArray(body?.items) ? body.items : [], page: Number(body?.page) || 1, limit: Number(body?.limit) || pageSize, total: Number(body?.total) || 0, totalPages: Number(body?.totalPages) || 0 }; }
async function readBody<T = unknown>(response: Response): Promise<T> { const text = await response.text(); if (!text) return {} as T; try { return JSON.parse(text) as T; } catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` } as T; } }
function errorMessage(body: unknown, fallback: string) { if (!body || typeof body !== 'object' || !('message' in body)) return fallback; const value = (body as { message?: unknown }).message; return typeof value === 'string' ? value : Array.isArray(value) ? value.join('. ') : fallback; }
