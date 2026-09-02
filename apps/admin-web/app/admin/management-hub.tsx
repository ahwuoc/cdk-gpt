'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, CalendarDays, ChevronLeft, ChevronRight, CircleDollarSign, FileClock,
  LoaderCircle, MinusCircle, PlusCircle, RefreshCw, Search, ShieldCheck, Users, X,
} from 'lucide-react';
import type { AuthorizedRequest } from './operations-dashboard';
import { requestId } from './request-id';

export type ManagementView = 'users' | 'ledger' | 'audit';

interface PageResult<T> { items: T[]; page: number; limit: number; total: number; totalPages: number; }
interface Person { id?: string; telegramId?: string; username?: string; displayName?: string; }
interface UserRecord extends Person {
  status: string; walletBalance: number; referralCode: string; purchaseCount: number; createdAt: string; updatedAt: string;
}
interface LedgerRecord {
  id: string; amount: number; balanceBefore: number; balanceAfter: number; type: string; reason: string;
  referenceType: string; referenceId?: string; idempotencyKey: string; actorType: string; actorId?: string;
  createdAt: string; user?: Person | null;
}
interface AuditRecord {
  id: string; actorType: string; action: string; resourceType: string; resourceId?: string;
  requestId?: string; createdAt: string; actor?: { id: string; name: string; kind: string } | null;
  changes?: unknown; metadata?: unknown;
}

const pageSize = 15;
const blankPage = <T,>(): PageResult<T> => ({ items: [], page: 1, limit: pageSize, total: 0, totalPages: 0 });

export function ManagementHub({ view, authorized, setMessage }: {
  view: ManagementView; authorized: AuthorizedRequest; setMessage(message: string): void;
}) {
  if (view === 'users') return <UsersDirectory authorized={authorized} setMessage={setMessage} />;
  if (view === 'ledger') return <WalletLedger authorized={authorized} setMessage={setMessage} />;
  return <AuditTracing authorized={authorized} setMessage={setMessage} />;
}

function UsersDirectory({ authorized, setMessage }: SharedProps) {
  const [query, setQuery] = useState({ search: '', status: '', from: '', to: '', page: 1 });
  const [adjusting, setAdjusting] = useState<UserRecord | null>(null);
  const { data, loading, load } = usePaginatedAdminQuery<UserRecord>(
    authorized, '/admin/users', query, setMessage, 'Không thể tải danh sách khách hàng.',
  );

  return <><ManagementPanel icon={<Users />} eyebrow="Khách hàng" title="Khách hàng Telegram"
    subtitle="Tra cứu người dùng, điều chỉnh số dư ví, xem lịch sử và nhắn tin tại một chỗ." loading={loading} refresh={load}>
    <Filters>
      <SearchField value={query.search} onChange={(search) => setQuery((current) => ({ ...current, search, page: 1 }))} placeholder="Tên, username, Telegram ID hoặc mã giới thiệu" />
      <select className="input h-11 py-2" value={query.status} onChange={(event) => setQuery((current) => ({ ...current, status: event.target.value, page: 1 }))}>
        <option value="">Tất cả trạng thái</option><option value="ACTIVE">Đang hoạt động</option><option value="SUSPENDED">Tạm khóa</option><option value="BLOCKED">Đã chặn</option>
      </select>
      <DateField label="Từ ngày" value={query.from} onChange={(from) => setQuery((current) => ({ ...current, from, page: 1 }))} />
      <DateField label="Đến ngày" value={query.to} onChange={(to) => setQuery((current) => ({ ...current, to, page: 1 }))} />
    </Filters>
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      <div className="hidden grid-cols-[minmax(0,1.5fr)_0.65fr_0.6fr_0.7fr] gap-4 border-b border-slate-800 px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-slate-500 md:grid">
        <span>Khách hàng</span><span>Số dư</span><span>Lượt mua</span><span>Tham gia</span>
      </div>
      <div className="divide-y divide-slate-800">
        {data.items.map((user) => <article key={user.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.5fr)_0.65fr_0.6fr_0.7fr] md:items-center">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium text-slate-100">{person(user)}</p><Badge value={user.status} /></div><p className="mt-1 truncate text-xs text-slate-500">Telegram {user.telegramId} · Mã {user.referralCode}</p>
            {user.id && <div className="mt-2 flex flex-wrap gap-2 text-[11px]"><HistoryLink view="orders" userId={user.id}>Đơn hàng</HistoryLink><HistoryLink view="deposits" userId={user.id}>Nạp tiền</HistoryLink><HistoryLink view="ledger" userId={user.id}>Sổ ví</HistoryLink>{user.telegramId && <a className="rounded-lg border border-slate-700 px-2 py-1 text-slate-400 transition hover:border-indigo-500/60 hover:text-indigo-200" href={`/admin?view=messages&telegramId=${encodeURIComponent(user.telegramId)}`}>Nhắn tin</a>}</div>}
          </div>
          <div><p className="font-semibold text-emerald-300">{money(user.walletBalance)}</p>{user.id && <button type="button" onClick={() => setAdjusting(user)} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11px] font-medium text-indigo-200 transition hover:border-indigo-400 hover:bg-indigo-500/20"><CircleDollarSign size={13} /> Cộng / trừ tiền</button>}</div>
          <p className="text-sm text-slate-300">{number(user.purchaseCount)} đơn</p>
          <p className="text-xs text-slate-400">{dateTime(user.createdAt)}</p>
        </article>)}
        {!loading && data.items.length === 0 && <Empty icon={<Users />} text="Không tìm thấy khách hàng phù hợp." />}
        {loading && <Loading />}
      </div>
    </div>
    <Pagination data={data} onPage={(next) => setQuery((current) => ({ ...current, page: next }))} />
  </ManagementPanel>{adjusting?.id && <WalletAdjustmentDialog user={adjusting} authorized={authorized}
    close={() => setAdjusting(null)} saved={async (result) => {
      setMessage(`${result.direction === 'CREDIT' ? 'Đã cộng' : 'Đã trừ'} ${money(Math.abs(result.amount))}. Số dư mới: ${money(result.balanceAfter)}.`);
      setAdjusting(null); await load();
    }} />}</>;
}

interface WalletAdjustmentResult {
  direction: 'CREDIT' | 'DEBIT'; amount: number; balanceBefore: number; balanceAfter: number;
}

function WalletAdjustmentDialog({ user, authorized, close, saved }: {
  user: UserRecord; authorized: AuthorizedRequest; close(): void;
  saved(result: WalletAdjustmentResult): Promise<void>;
}) {
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const numericAmount = Number(amount);
  const validAmount = Number.isSafeInteger(numericAmount) && numericAmount > 0;
  const projected = direction === 'CREDIT' ? user.walletBalance + (validAmount ? numericAmount : 0)
    : user.walletBalance - (validAmount ? numericAmount : 0);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [busy, close]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!validAmount) return setError('Số tiền phải là số nguyên dương.');
    if (direction === 'DEBIT' && numericAmount > user.walletBalance) return setError('Không thể trừ quá số dư hiện tại.');
    if (reason.trim().length < 3) return setError('Hãy nhập lý do ít nhất 3 ký tự để lưu vào sổ ví.');
    if (direction === 'DEBIT' && !window.confirm(`Xác nhận trừ ${money(numericAmount)} của ${person(user)}?`)) return;
    setBusy(true);
    try {
      if (!user.id) throw new Error('Không tìm thấy ID khách hàng.');
      const response = await authorized(`/admin/users/${user.id}/wallet-adjustments`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify({ direction, amount: numericAmount, reason: reason.trim() }),
      });
      const body = await json<WalletAdjustmentResult>(response);
      if (!response.ok) throw new Error(message(body, 'Không thể điều chỉnh số dư.'));
      await saved(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể điều chỉnh số dư.'); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="wallet-adjustment-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
    <form onSubmit={(event) => void submit(event)} className="w-full max-w-xl rounded-t-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-indigo-300">Điều chỉnh ví khách hàng</p><h3 id="wallet-adjustment-title" className="mt-1 text-xl font-semibold text-white">{person(user)}</h3><p className="mt-1 text-xs text-slate-400">Telegram {user.telegramId} · Hiện có {money(user.walletBalance)}</p></div><button type="button" onClick={close} disabled={busy} className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:text-white" aria-label="Đóng"><X size={18} /></button></div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setDirection('CREDIT')} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition ${direction === 'CREDIT' ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200' : 'border-slate-700 text-slate-400 hover:border-slate-600'}`}><PlusCircle size={17} /> Cộng tiền</button>
        <button type="button" onClick={() => setDirection('DEBIT')} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition ${direction === 'DEBIT' ? 'border-rose-400/60 bg-rose-500/15 text-rose-200' : 'border-slate-700 text-slate-400 hover:border-slate-600'}`}><MinusCircle size={17} /> Trừ tiền</button>
      </div>
      <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-400">Số tiền (VNĐ)<input autoFocus inputMode="numeric" className="input mt-2" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, '').slice(0, 13))} placeholder="Ví dụ: 100000" /></label>
      <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-400">Lý do<textarea className="input mt-2 min-h-24 resize-y" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: Hoàn tiền đơn ORD-... hoặc điều chỉnh sai lệch" /></label>
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-center text-xs"><div><p className="text-slate-500">Trước</p><p className="mt-1 font-medium text-slate-200">{money(user.walletBalance)}</p></div><div><p className="text-slate-500">Thay đổi</p><p className={`mt-1 font-medium ${direction === 'CREDIT' ? 'text-emerald-300' : 'text-rose-300'}`}>{direction === 'CREDIT' ? '+' : '-'}{money(validAmount ? numericAmount : 0)}</p></div><div><p className="text-slate-500">Sau</p><p className={`mt-1 font-medium ${projected < 0 ? 'text-rose-300' : 'text-white'}`}>{money(projected)}</p></div></div>
      {error && <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={close} disabled={busy} className="button-secondary px-4 py-2.5">Hủy</button><button type="submit" disabled={busy || !validAmount || reason.trim().length < 3 || projected < 0} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${direction === 'CREDIT' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : direction === 'CREDIT' ? <PlusCircle size={16} /> : <MinusCircle size={16} />}{direction === 'CREDIT' ? 'Xác nhận cộng tiền' : 'Xác nhận trừ tiền'}</button></div>
    </form>
  </div>;
}

function WalletLedger({ authorized, setMessage }: SharedProps) {
  const [query, setQuery] = useState({ search: '', userId: '', type: '', actorType: '', from: '', to: '', page: 1 });
  const { data, loading, load } = usePaginatedAdminQuery<LedgerRecord>(
    authorized, '/admin/wallet-transactions', query, setMessage, 'Không thể tải sổ cái ví.',
  );
  useUrlUserFilter((userId) => setQuery((current) => ({ ...current, userId, page: 1 })));

  return <ManagementPanel icon={<CircleDollarSign />} eyebrow="Tài chính" title="Sổ cái ví"
    subtitle="Mỗi thay đổi số dư đều có số dư trước/sau, nguyên nhân và khóa chống trùng." loading={loading} refresh={load}>
    {query.userId && <ScopedUserFilter userId={query.userId} clear={() => { clearUrlUserFilter(); setQuery((current) => ({ ...current, userId: '', page: 1 })); }} />}
    <Filters>
      <SearchField value={query.search} onChange={(search) => setQuery((current) => ({ ...current, search, page: 1 }))} placeholder="Khách, lý do hoặc idempotency key" />
      <select className="input h-11 py-2" value={query.type} onChange={(event) => setQuery((current) => ({ ...current, type: event.target.value, page: 1 }))}>
        <option value="">Tất cả loại</option>{['DEPOSIT', 'PURCHASE', 'REFUND', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'REFERRAL_COMMISSION', 'ADJUSTMENT'].map((value) => <option key={value}>{value}</option>)}
      </select>
      <select className="input h-11 py-2" value={query.actorType} onChange={(event) => setQuery((current) => ({ ...current, actorType: event.target.value, page: 1 }))}>
        <option value="">Tất cả tác nhân</option>{['USER', 'ADMIN', 'SYSTEM', 'WEBHOOK'].map((value) => <option key={value}>{value}</option>)}
      </select>
      <DateField label="Từ ngày" value={query.from} onChange={(from) => setQuery((current) => ({ ...current, from, page: 1 }))} />
      <DateField label="Đến ngày" value={query.to} onChange={(to) => setQuery((current) => ({ ...current, to, page: 1 }))} />
    </Filters>
    <div className="mt-4 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      {data.items.map((entry) => <article key={entry.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.4fr)_0.8fr_0.9fr] lg:items-center">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge value={entry.type} /><span className="text-xs text-slate-500">{entry.actorType}</span></div><p className="mt-2 truncate text-sm font-medium text-slate-100">{person(entry.user)}</p><p className="mt-1 truncate text-xs text-slate-500">{entry.reason}</p></div>
        <div><p className={`font-semibold ${entry.amount > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{entry.amount > 0 ? '+' : ''}{money(entry.amount)}</p><p className="mt-1 text-xs text-slate-500">{money(entry.balanceBefore)} → {money(entry.balanceAfter)}</p></div>
        <div className="min-w-0 lg:text-right"><p className="text-xs text-slate-400">{dateTime(entry.createdAt)}</p><code className="mt-1 block truncate text-[10px] text-indigo-300" title={entry.idempotencyKey}>{entry.idempotencyKey}</code><p className="mt-1 truncate text-[10px] text-slate-600">{entry.referenceType}{entry.referenceId ? ` · ${entry.referenceId}` : ''}</p></div>
      </article>)}
      {!loading && data.items.length === 0 && <Empty icon={<CircleDollarSign />} text="Chưa có biến động ví phù hợp." />}
      {loading && <Loading />}
    </div>
    <Pagination data={data} onPage={(next) => setQuery((current) => ({ ...current, page: next }))} />
  </ManagementPanel>;
}

function AuditTracing({ authorized, setMessage }: SharedProps) {
  const [query, setQuery] = useState({ search: '', actorType: '', action: '', resourceType: '', requestId: '', from: '', to: '', page: 1 });
  const { data, loading, load } = usePaginatedAdminQuery<AuditRecord>(
    authorized, '/admin/audit-logs', query, setMessage, 'Không thể tải nhật ký hệ thống.',
  );

  return <ManagementPanel icon={<Activity />} eyebrow="Quan sát hệ thống" title="Nhật ký & tracing"
    subtitle="Theo dõi ai đã làm gì; dùng request ID để nối các thay đổi trong cùng một thao tác." loading={loading} refresh={load}>
    <Filters>
      <SearchField value={query.search} onChange={(search) => setQuery((current) => ({ ...current, search, page: 1 }))} placeholder="Hành động, tài nguyên hoặc người thực hiện" />
      <input className="input h-11 py-2" value={query.requestId} onChange={(event) => setQuery((current) => ({ ...current, requestId: event.target.value, page: 1 }))} placeholder="Request ID chính xác" />
      <select className="input h-11 py-2" value={query.actorType} onChange={(event) => setQuery((current) => ({ ...current, actorType: event.target.value, page: 1 }))}><option value="">Mọi tác nhân</option><option>ADMIN</option><option>USER</option><option>SYSTEM</option></select>
      <input className="input h-11 py-2" value={query.action} onChange={(event) => setQuery((current) => ({ ...current, action: event.target.value, page: 1 }))} placeholder="Action chính xác" />
      <input className="input h-11 py-2" value={query.resourceType} onChange={(event) => setQuery((current) => ({ ...current, resourceType: event.target.value, page: 1 }))} placeholder="Loại tài nguyên" />
      <DateField label="Từ ngày" value={query.from} onChange={(from) => setQuery((current) => ({ ...current, from, page: 1 }))} />
      <DateField label="Đến ngày" value={query.to} onChange={(to) => setQuery((current) => ({ ...current, to, page: 1 }))} />
    </Filters>
    <div className="mt-4 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      {data.items.map((entry) => <article key={entry.id} className="px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge value={entry.action} /><span className="text-xs text-slate-500">{entry.actor?.name ?? entry.actorType}</span></div><p className="mt-2 text-sm text-slate-200">{entry.resourceType}{entry.resourceId ? <code className="ml-2 text-xs text-slate-500">{entry.resourceId}</code> : null}</p></div><div className="lg:text-right"><p className="text-xs text-slate-400">{dateTime(entry.createdAt)}</p>{entry.requestId && <code className="mt-1 block break-all text-[10px] text-indigo-300">trace: {entry.requestId}</code>}</div></div>
        <TraceMetrics metadata={entry.metadata} />
        {(hasDetails(entry.metadata) || hasDetails(entry.changes)) && <details className="mt-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-300">Chi tiết đã được lọc dữ liệu nhạy cảm</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-5 text-slate-400">{JSON.stringify({ changes: entry.changes, metadata: entry.metadata }, null, 2)}</pre></details>}
      </article>)}
      {!loading && data.items.length === 0 && <Empty icon={<FileClock />} text="Không tìm thấy trace phù hợp." />}
      {loading && <Loading />}
    </div>
    <Pagination data={data} onPage={(next) => setQuery((current) => ({ ...current, page: next }))} />
  </ManagementPanel>;
}

interface SharedProps { authorized: AuthorizedRequest; setMessage(message: string): void; }
function usePaginatedAdminQuery<T>(authorized: AuthorizedRequest, path: string,
  query: Record<string, string | number>, setMessage: (message: string) => void, fallback: string) {
  const [data, setData] = useState<PageResult<T>>(blankPage);
  const [loading, setLoading] = useState(true);
  const activeRequest = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    try {
      const response = await authorized(`${path}?${params({ ...query, limit: pageSize })}`, { signal: controller.signal });
      const body = await json<PageResult<T>>(response);
      if (!response.ok) throw new Error(message(body, fallback));
      if (!controller.signal.aborted) setData(page(body));
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setMessage(error instanceof Error ? error.message : fallback);
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setLoading(false); }
    }
  }, [authorized, fallback, path, query, setMessage]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 400);
    return () => { window.clearTimeout(timer); activeRequest.current?.abort(); };
  }, [load]);
  return { data, loading, load };
}
function useUrlUserFilter(apply: (userId: string) => void) {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const userId = new URL(window.location.href).searchParams.get('userId')?.trim();
    if (userId) apply(userId);
  }, [apply]);
}
function ManagementPanel({ icon, eyebrow, title, subtitle, loading, refresh, children }: {
  icon: ReactNode; eyebrow: string; title: string; subtitle: string; loading: boolean; refresh(): Promise<void>; children: ReactNode;
}) {
  return <section className="space-y-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-3"><span className="rounded-2xl bg-indigo-500/12 p-3 text-indigo-300">{icon}</span><div><p className="text-sm font-medium text-indigo-300">{eyebrow}</p><h2 className="mt-1 text-2xl font-semibold text-white">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{subtitle}</p></div></div><button onClick={() => void refresh()} disabled={loading} className="button-secondary inline-flex items-center justify-center gap-2 px-3 py-2.5"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Làm mới</button></div><div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-5">{children}</div></section>;
}
function Filters({ children }: { children: ReactNode }) { return <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{children}</div>; }
function SearchField({ value, onChange, placeholder }: { value: string; onChange(value: string): void; placeholder: string }) { return <label className="relative md:col-span-2"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input h-11 py-2 pl-10" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>; }
function DateField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) { return <label className="relative"><CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input h-11 py-2 pl-9" type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} /></label>; }
function Pagination<T>({ data, onPage }: { data: PageResult<T>; onPage(page: number): void }) { if (!data.totalPages) return null; return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-slate-500">Hiển thị {data.total ? (data.page - 1) * data.limit + 1 : 0}–{Math.min(data.page * data.limit, data.total)} / {data.total}</p><div className="flex items-center gap-2"><button disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} className="button-secondary inline-flex items-center gap-1 px-3 py-2"><ChevronLeft size={15} />Trước</button><span className="min-w-20 text-center text-xs text-slate-400">{data.page}/{data.totalPages}</span><button disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)} className="button-secondary inline-flex items-center gap-1 px-3 py-2">Sau<ChevronRight size={15} /></button></div></div>; }
function Badge({ value }: { value: string }) { const good = ['ACTIVE', 'DEPOSIT', 'REFUND', 'ADMIN_CREDIT'].includes(value); const bad = ['BLOCKED', 'SUSPENDED', 'PURCHASE', 'ADMIN_DEBIT'].includes(value); return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${good ? 'bg-emerald-500/15 text-emerald-300' : bad ? 'bg-rose-500/15 text-rose-300' : 'bg-indigo-500/15 text-indigo-300'}`}>{value}</span>; }
function Empty({ icon, text }: { icon: ReactNode; text: string }) { return <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-8 text-sm text-slate-500"><span className="text-slate-600">{icon}</span>{text}</div>; }
function Loading() { return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18} />Đang tải dữ liệu…</div>; }
function TraceMetrics({ metadata }: { metadata: unknown }) { if (!metadata || typeof metadata !== 'object') return null; const values = metadata as Record<string, unknown>; if (typeof values.method !== 'string' || typeof values.path !== 'string') return null; const status = Number(values.statusCode); const duration = Number(values.durationMs); return <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]"><code className="rounded-lg bg-slate-800 px-2 py-1 text-sky-200">{values.method} {values.path}</code>{Number.isFinite(status) && <span className={`rounded-lg px-2 py-1 ${status < 400 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>HTTP {status}</span>}{Number.isFinite(duration) && <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300">{duration} ms</span>}</div>; }
function HistoryLink({ view, userId, children }: { view: 'orders' | 'deposits' | 'ledger'; userId: string; children: ReactNode }) { return <a className="rounded-lg border border-slate-700 px-2 py-1 text-slate-400 transition hover:border-indigo-500/60 hover:text-indigo-200" href={`/admin?view=${view}&userId=${encodeURIComponent(userId)}`}>{children}</a>; }
function ScopedUserFilter({ userId, clear }: { userId: string; clear(): void }) { return <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100"><span>Đang xem lịch sử riêng của khách <code>{userId}</code></span><button type="button" onClick={clear} className="rounded-lg bg-slate-950/60 px-2 py-1 text-indigo-200 hover:text-white">Bỏ lọc</button></div>; }
function clearUrlUserFilter() { const url = new URL(window.location.href); url.searchParams.delete('userId'); window.history.replaceState(window.history.state, '', url); }
function page<T>(value: PageResult<T>): PageResult<T> { return { items: Array.isArray(value?.items) ? value.items : [], page: Number(value?.page) || 1, limit: Number(value?.limit) || pageSize, total: Number(value?.total) || 0, totalPages: Number(value?.totalPages) || 0 }; }
function params(input: Record<string, string | number>) { const result = new URLSearchParams(); for (const [key, value] of Object.entries(input)) if (value !== '') result.set(key, String(value)); return result.toString(); }
async function json<T>(response: Response): Promise<T> { const text = await response.text(); if (!text) return {} as T; try { return JSON.parse(text) as T; } catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` } as T; } }
function message(body: unknown, fallback: string) { if (!body || typeof body !== 'object' || !('message' in body)) return fallback; const value = (body as { message?: unknown }).message; return typeof value === 'string' ? value : Array.isArray(value) ? value.join('. ') : fallback; }
function person(user?: Person | null) {
  if (!user) return 'Khách đã xóa';
  const handle = user.username ? `@${user.username.replace(/^@+/, '')}` : '';
  return [user.displayName, handle].filter(Boolean).join(' · ') || (user.telegramId ? `Telegram ${user.telegramId}` : 'Khách hàng');
}
function number(value: number) { return new Intl.NumberFormat('vi-VN').format(value || 0); }
function money(value: number) { return `${new Intl.NumberFormat('vi-VN').format(value || 0)} đ`; }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
function hasDetails(value: unknown) { return Boolean(value && typeof value === 'object' && Object.keys(value as object).length); }
