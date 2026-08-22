'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Coins,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Search,
  TriangleAlert,
  Users,
  WalletCards,
} from 'lucide-react';

export type AuthorizedRequest = (path: string, init?: RequestInit) => Promise<Response>;
type HubView = 'overview' | 'orders' | 'deposits';

interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Summary {
  orders?: { total?: number; today?: number; completed?: number; pendingDelivery?: number };
  revenue?: { total?: number; today?: number };
  deposits?: { total?: number; today?: number; pending?: number };
  users?: { total?: number; newToday?: number };
  inventory?: { available?: number; lowStock?: number };
  recentOrders?: OrderRecord[];
  recentDeposits?: DepositRecord[];
}

interface Person {
  telegramId?: string;
  username?: string;
  displayName?: string;
}

interface OrderRecord {
  id: string;
  orderCode: string;
  totalAmount: number;
  unitPrice?: number;
  quantity?: number;
  status: string;
  deliveryStatus?: string;
  paymentMethod?: string;
  createdAt: string;
  deliveredAt?: string;
  product?: { _id?: string; name?: string; slug?: string } | null;
  user?: Person | null;
}

interface DepositRecord {
  id: string;
  requestCode: string;
  amount: number;
  provider?: string;
  providerReference?: string;
  transferContent?: string;
  rejectionReason?: string;
  status: string;
  createdAt: string;
  reviewedAt?: string;
  user?: Person | null;
}

const pageSize = 12;
const blankPage = <T,>(): PageResult<T> => ({ items: [], page: 1, limit: pageSize, total: 0, totalPages: 0 });

export function OperationsDashboard({ authorized, onOpenCatalog, onOpenInventory, setMessage }: {
  authorized: AuthorizedRequest;
  onOpenCatalog(): void;
  onOpenInventory(): void;
  setMessage(message: string): void;
}) {
  const [view, setView] = useState<HubView>('overview');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<PageResult<OrderRecord>>(blankPage);
  const [deposits, setDeposits] = useState<PageResult<DepositRecord>>(blankPage);
  const [summaryBusy, setSummaryBusy] = useState(true);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [ordersQuery, setOrdersQuery] = useState({ search: '', status: '', from: '', to: '', page: 1 });
  const [depositsQuery, setDepositsQuery] = useState({ search: '', status: '', provider: '', from: '', to: '', page: 1 });

  const loadSummary = useCallback(async (quiet = false) => {
    if (!quiet) setSummaryBusy(true);
    try {
      const response = await authorized('/admin/analytics/summary');
      const body = await readApiBody<Summary>(response);
      if (!response.ok) throw new Error(messageFromBody(body, 'Không thể tải thống kê.'));
      setSummary(body);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải thống kê.');
    } finally {
      if (!quiet) setSummaryBusy(false);
    }
  }, [authorized, setMessage]);

  const loadOrders = useCallback(async () => {
    setHistoryBusy(true);
    try {
      const query = paramsFor({ ...ordersQuery, limit: String(pageSize) });
      const response = await authorized(`/admin/orders?${query}`);
      const body = await readApiBody<PageResult<OrderRecord>>(response);
      if (!response.ok) throw new Error(messageFromBody(body, 'Không thể tải lịch sử đơn hàng.'));
      setOrders(normalizePage(body));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải lịch sử đơn hàng.');
    } finally {
      setHistoryBusy(false);
    }
  }, [authorized, ordersQuery, setMessage]);

  const loadDeposits = useCallback(async () => {
    setHistoryBusy(true);
    try {
      const query = paramsFor({ ...depositsQuery, limit: String(pageSize) });
      const response = await authorized(`/admin/deposits?${query}`);
      const body = await readApiBody<PageResult<DepositRecord>>(response);
      if (!response.ok) throw new Error(messageFromBody(body, 'Không thể tải lịch sử nạp tiền.'));
      setDeposits(normalizePage(body));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải lịch sử nạp tiền.');
    } finally {
      setHistoryBusy(false);
    }
  }, [authorized, depositsQuery, setMessage]);

  useEffect(() => { queueMicrotask(() => void loadSummary()); }, [loadSummary]);
  useEffect(() => {
    if (view === 'overview') return;
    const timer = window.setTimeout(() => {
      if (view === 'orders') void loadOrders();
      if (view === 'deposits') void loadDeposits();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadDeposits, loadOrders, view]);

  const stats = useMemo(() => [
    { label: 'Doanh thu', value: money(summary?.revenue?.total), today: `Hôm nay ${money(summary?.revenue?.today)}`, icon: <CircleDollarSign />, tone: 'indigo' },
    { label: 'Đơn hàng', value: number(summary?.orders?.total), today: `${number(summary?.orders?.today)} đơn hôm nay`, icon: <ClipboardList />, tone: 'sky' },
    { label: 'Nạp tiền', value: money(summary?.deposits?.total), today: `${number(summary?.deposits?.pending)} yêu cầu chờ duyệt`, icon: <WalletCards />, tone: 'emerald' },
    { label: 'Khách hàng', value: number(summary?.users?.total), today: `+${number(summary?.users?.newToday)} khách hôm nay`, icon: <Users />, tone: 'violet' },
  ], [summary]);

  return <section className="space-y-5" aria-label="Vận hành cửa hàng">
    <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/50 p-5 shadow-xl sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-300">Trung tâm vận hành</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">Theo dõi shop trong một chỗ</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Xem doanh thu, đơn hàng, tiền nạp và tồn kho mà không phải tìm từng mục.</p>
        </div>
        <button type="button" onClick={() => void loadSummary()} disabled={summaryBusy} className="button-secondary inline-flex shrink-0 items-center justify-center gap-2 px-3 py-2.5">
          <RefreshCw size={15} className={summaryBusy ? 'animate-spin' : ''} /> Làm mới
        </button>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => <StatCard key={stat.label} {...stat} loading={summaryBusy} />)}
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <QuickAction icon={<PackageCheck size={18} />} title="Thêm sản phẩm" description="Tạo danh mục hoặc sản phẩm mới" action="Mở sản phẩm" onClick={onOpenCatalog} />
        <QuickAction icon={<Coins size={18} />} title="Nhập hàng vào kho" description={`${number(summary?.inventory?.available)} tài khoản còn sẵn`} action="Nhập kho" onClick={onOpenInventory} />
        <QuickAction icon={<TriangleAlert size={18} />} title="Cần chú ý" description={`${number(summary?.inventory?.lowStock)} sản phẩm sắp hết hàng`} action="Kiểm tra kho" onClick={onOpenCatalog} danger={Number(summary?.inventory?.lowStock ?? 0) > 0} />
      </div>
    </div>

    <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-2" role="tablist" aria-label="Thống kê và lịch sử">
      <HubTab active={view === 'overview'} onClick={() => setView('overview')} icon={<Banknote size={16} />}>Tổng quan</HubTab>
      <HubTab active={view === 'orders'} onClick={() => setView('orders')} icon={<ClipboardList size={16} />}>Đơn hàng</HubTab>
      <HubTab active={view === 'deposits'} onClick={() => setView('deposits')} icon={<WalletCards size={16} />}>Lịch sử nạp</HubTab>
    </div>

    {view === 'overview' && <Overview
      summary={summary}
      loading={summaryBusy}
      onOrders={() => setView('orders')}
      onDeposits={() => setView('deposits')}
    />}
    {view === 'orders' && <OrdersHistory
      data={orders}
      loading={historyBusy}
      query={ordersQuery}
      setQuery={setOrdersQuery}
      refresh={loadOrders}
    />}
    {view === 'deposits' && <DepositsHistory
      data={deposits}
      loading={historyBusy}
      query={depositsQuery}
      setQuery={setDepositsQuery}
      refresh={loadDeposits}
    />}
  </section>;
}

function Overview({ summary, loading, onOrders, onDeposits }: { summary: Summary | null; loading: boolean; onOrders(): void; onDeposits(): void }) {
  return <div className="grid gap-5 xl:grid-cols-2">
    <HistoryPreview title="Đơn hàng mới nhất" icon={<ClipboardList size={18} />} action="Xem tất cả đơn" onClick={onOrders} loading={loading} empty="Chưa có đơn hàng nào.">
      {(summary?.recentOrders ?? []).map((order) => <OrderRow key={order.id} order={order} compact />)}
    </HistoryPreview>
    <HistoryPreview title="Nạp tiền mới nhất" icon={<WalletCards size={18} />} action="Xem lịch sử nạp" onClick={onDeposits} loading={loading} empty="Chưa có yêu cầu nạp tiền nào.">
      {(summary?.recentDeposits ?? []).map((deposit) => <DepositRow key={deposit.id} deposit={deposit} compact />)}
    </HistoryPreview>
  </div>;
}

function OrdersHistory({ data, loading, query, setQuery, refresh }: {
  data: PageResult<OrderRecord>;
  loading: boolean;
  query: { search: string; status: string; from: string; to: string; page: number };
  setQuery: Dispatch<SetStateAction<{ search: string; status: string; from: string; to: string; page: number }>>;
  refresh(): Promise<void>;
}) {
  return <HistoryPanel title="Lịch sử đơn hàng" subtitle="Tìm theo mã đơn, khách hàng hoặc sản phẩm." icon={<ClipboardList size={19} />} loading={loading} refresh={refresh}>
    <FilterBar>
      <SearchField value={query.search} onChange={(search) => setQuery((current) => ({ ...current, search, page: 1 }))} placeholder="Mã đơn, khách hoặc sản phẩm" />
      <select className="input h-11 py-2" value={query.status} onChange={(event) => setQuery((current) => ({ ...current, status: event.target.value, page: 1 }))} aria-label="Lọc trạng thái đơn hàng">
        <option value="">Tất cả trạng thái</option>
        <option value="PENDING_DELIVERY">Chờ giao</option><option value="DELIVERING">Đang giao</option><option value="DELIVERED">Đã giao</option>
        <option value="DELIVERY_FAILED">Giao lỗi</option><option value="REFUNDED">Đã hoàn tiền</option><option value="CANCELLED">Đã hủy</option>
      </select>
      <DateField label="Từ ngày" value={query.from} onChange={(from) => setQuery((current) => ({ ...current, from, page: 1 }))} />
      <DateField label="Đến ngày" value={query.to} onChange={(to) => setQuery((current) => ({ ...current, to, page: 1 }))} />
    </FilterBar>
    <div className="mt-4 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      {data.items.map((order) => <OrderRow key={order.id} order={order} />)}
      {!loading && data.items.length === 0 && <EmptyState icon={<ClipboardList />} text="Không tìm thấy đơn hàng phù hợp." />}
      {loading && <LoadingRows />}
    </div>
    <Pagination data={data} onPage={(page) => setQuery((current) => ({ ...current, page }))} />
  </HistoryPanel>;
}

function DepositsHistory({ data, loading, query, setQuery, refresh }: {
  data: PageResult<DepositRecord>;
  loading: boolean;
  query: { search: string; status: string; provider: string; from: string; to: string; page: number };
  setQuery: Dispatch<SetStateAction<{ search: string; status: string; provider: string; from: string; to: string; page: number }>>;
  refresh(): Promise<void>;
}) {
  return <HistoryPanel title="Lịch sử nạp tiền" subtitle="Theo dõi các yêu cầu nạp và trạng thái đã cộng tiền." icon={<WalletCards size={19} />} loading={loading} refresh={refresh}>
    <FilterBar>
      <SearchField value={query.search} onChange={(search) => setQuery((current) => ({ ...current, search, page: 1 }))} placeholder="Mã nạp, mã giao dịch hoặc khách" />
      <select className="input h-11 py-2" value={query.status} onChange={(event) => setQuery((current) => ({ ...current, status: event.target.value, page: 1 }))} aria-label="Lọc trạng thái nạp tiền">
        <option value="">Tất cả trạng thái</option><option value="PENDING">Đang chờ</option><option value="APPROVED">Đã cộng tiền</option><option value="REJECTED">Từ chối</option><option value="EXPIRED">Hết hạn</option>
      </select>
      <input className="input h-11 py-2" value={query.provider} onChange={(event) => setQuery((current) => ({ ...current, provider: event.target.value, page: 1 }))} placeholder="Nguồn, ví dụ CAKE" aria-label="Nguồn nạp tiền" />
      <DateField label="Từ ngày" value={query.from} onChange={(from) => setQuery((current) => ({ ...current, from, page: 1 }))} />
      <DateField label="Đến ngày" value={query.to} onChange={(to) => setQuery((current) => ({ ...current, to, page: 1 }))} />
    </FilterBar>
    <div className="mt-4 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      {data.items.map((deposit) => <DepositRow key={deposit.id} deposit={deposit} />)}
      {!loading && data.items.length === 0 && <EmptyState icon={<WalletCards />} text="Không tìm thấy lịch sử nạp tiền phù hợp." />}
      {loading && <LoadingRows />}
    </div>
    <Pagination data={data} onPage={(page) => setQuery((current) => ({ ...current, page }))} />
  </HistoryPanel>;
}

function HistoryPanel({ title, subtitle, icon, children, loading, refresh }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode; loading: boolean; refresh(): Promise<void> }) {
  return <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex gap-3"><span className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-300">{icon}</span><div><h3 className="font-semibold text-white">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</p></div></div>
      <button type="button" onClick={() => void refresh()} disabled={loading} className="button-secondary inline-flex items-center gap-2 px-3 py-2"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Tải lại</button>
    </div>
    {children}
  </section>;
}

function HistoryPreview({ title, icon, action, onClick, loading, empty, children }: { title: string; icon: ReactNode; action: string; onClick(): void; loading: boolean; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) && children.length > 0;
  return <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-xl">
    <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
      <div className="flex items-center gap-2 text-slate-100"><span className="text-indigo-300">{icon}</span><h3 className="font-semibold">{title}</h3></div>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-sm text-indigo-300 hover:text-indigo-200">{action}<ArrowUpRight size={15} /></button>
    </div>
    <div className="divide-y divide-slate-800">{loading ? <LoadingRows /> : hasChildren ? children : <EmptyState icon={icon} text={empty} />}</div>
  </section>;
}

function OrderRow({ order, compact = false }: { order: OrderRecord; compact?: boolean }) {
  return <article className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${compact ? 'px-5' : ''}`}>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><code className="text-xs font-semibold text-indigo-200">{order.orderCode}</code><StatusBadge value={order.status} type="order" /></div>
      <p className="mt-1 truncate text-sm font-medium text-slate-100">{order.product?.name ?? 'Sản phẩm đã xóa'}</p>
      <p className="mt-1 text-xs text-slate-500">{person(order.user)} · {dateTime(order.createdAt)}{order.quantity && order.quantity > 1 ? ` · SL ${order.quantity}` : ''}</p>
    </div>
    <div className="flex items-center justify-between gap-3 sm:block sm:text-right"><p className="font-semibold text-emerald-300">{money(order.totalAmount)}</p><p className="mt-1 text-xs text-slate-500">{paymentName(order.paymentMethod)}</p></div>
  </article>;
}

function DepositRow({ deposit, compact = false }: { deposit: DepositRecord; compact?: boolean }) {
  return <article className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${compact ? 'px-5' : ''}`}>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><code className="text-xs font-semibold text-indigo-200">{deposit.requestCode}</code><StatusBadge value={deposit.status} type="deposit" /></div>
      <p className="mt-1 truncate text-sm font-medium text-slate-100">{person(deposit.user)}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{deposit.provider ?? 'BANK'}{deposit.providerReference ? ` · ${deposit.providerReference}` : ''}{deposit.transferContent ? ` · ${deposit.transferContent}` : ''} · {dateTime(deposit.createdAt)}</p>
      {deposit.rejectionReason && <p className="mt-1 truncate text-xs text-rose-300">Lý do: {deposit.rejectionReason}</p>}
    </div>
    <div className="flex items-center justify-between gap-3 sm:block sm:text-right"><p className="font-semibold text-emerald-300">+{money(deposit.amount)}</p><p className="mt-1 text-xs text-slate-500">{deposit.reviewedAt ? `Duyệt ${dateTime(deposit.reviewedAt)}` : 'Chưa duyệt'}</p></div>
  </article>;
}

function QuickAction({ icon, title, description, action, onClick, danger = false }: { icon: ReactNode; title: string; description: string; action: string; onClick(): void; danger?: boolean }) {
  return <button type="button" onClick={onClick} className="group flex items-center gap-3 rounded-2xl border border-slate-700/80 bg-slate-950/50 p-4 text-left transition hover:border-indigo-500/60 hover:bg-slate-950">
    <span className={`rounded-xl p-2.5 ${danger ? 'bg-amber-400/10 text-amber-300' : 'bg-indigo-500/10 text-indigo-300'}`}>{icon}</span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-100">{title}</span><span className="mt-1 block truncate text-xs text-slate-400">{description}</span></span>
    <span className="text-xs font-medium text-indigo-300 group-hover:text-indigo-200">{action}</span>
  </button>;
}

function StatCard({ label, value, today, icon, tone, loading }: { label: string; value: string; today: string; icon: ReactNode; tone: string; loading: boolean }) {
  const tones: Record<string, string> = { indigo: 'bg-indigo-500/12 text-indigo-300', sky: 'bg-sky-500/12 text-sky-300', emerald: 'bg-emerald-500/12 text-emerald-300', violet: 'bg-violet-500/12 text-violet-300' };
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p><span className={`rounded-lg p-2 ${tones[tone]}`}>{icon}</span></div>
    <p className={`mt-5 text-2xl font-semibold tracking-tight text-white ${loading ? 'animate-pulse opacity-45' : ''}`}>{value}</p>
    <p className="mt-1.5 text-xs text-slate-500">{today}</p>
  </div>;
}

function HubTab({ active, onClick, icon, children }: { active: boolean; onClick(): void; icon: ReactNode; children: ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/60' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}>{icon}{children}</button>;
}

function FilterBar({ children }: { children: ReactNode }) { return <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-5">{children}</div>; }
function SearchField({ value, onChange, placeholder }: { value: string; onChange(value: string): void; placeholder: string }) { return <label className="relative md:col-span-2 xl:col-span-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input h-11 py-2 pl-10" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>; }
function DateField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) { return <label className="relative"><CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input h-11 py-2 pl-9" type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} /></label>; }

function Pagination<T>({ data, onPage }: { data: PageResult<T>; onPage(page: number): void }) {
  if (!data.total && !data.totalPages) return null;
  const pages = Math.max(data.totalPages, 1);
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-slate-500">Hiển thị <span className="text-slate-300">{data.total ? (data.page - 1) * data.limit + 1 : 0}–{Math.min(data.page * data.limit, data.total)}</span> / {data.total}</p><div className="flex items-center gap-2"><button type="button" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} className="button-secondary inline-flex items-center gap-1 px-3 py-2"><ChevronLeft size={15} />Trước</button><span className="min-w-20 text-center text-xs text-slate-400">Trang {data.page}/{pages}</span><button type="button" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)} className="button-secondary inline-flex items-center gap-1 px-3 py-2">Sau<ChevronRight size={15} /></button></div></div>;
}

function StatusBadge({ value, type }: { value: string; type: 'order' | 'deposit' }) {
  const order: Record<string, [string, string]> = {
    PENDING_DELIVERY: ['Chờ giao', 'bg-amber-500/15 text-amber-300'], DELIVERING: ['Đang giao', 'bg-sky-500/15 text-sky-300'], DELIVERED: ['Đã giao', 'bg-emerald-500/15 text-emerald-300'], DELIVERY_FAILED: ['Giao lỗi', 'bg-rose-500/15 text-rose-300'], REFUNDED: ['Hoàn tiền', 'bg-violet-500/15 text-violet-300'], CANCELLED: ['Đã hủy', 'bg-slate-500/15 text-slate-300'],
  };
  const deposit: Record<string, [string, string]> = {
    PENDING: ['Đang chờ', 'bg-amber-500/15 text-amber-300'], APPROVED: ['Đã cộng tiền', 'bg-emerald-500/15 text-emerald-300'], REJECTED: ['Từ chối', 'bg-rose-500/15 text-rose-300'], EXPIRED: ['Hết hạn', 'bg-slate-500/15 text-slate-300'],
  };
  const [label, color] = (type === 'order' ? order : deposit)[value] ?? [value, 'bg-slate-500/15 text-slate-300'];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>{label}</span>;
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) { return <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm text-slate-500"><span className="text-slate-600">{icon}</span><p>{text}</p></div>; }
function LoadingRows() { return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-400"><LoaderCircle size={18} className="animate-spin" />Đang tải dữ liệu…</div>; }

function number(value: number | undefined) { return new Intl.NumberFormat('vi-VN').format(value ?? 0); }
function money(value: number | undefined) { return `${number(value)} đ`; }
function dateTime(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
function person(user?: Person | null) { if (!user) return 'Khách đã xóa'; if (user.displayName) return user.displayName; if (user.username) return `@${user.username}`; return user.telegramId ? `Telegram ${user.telegramId}` : 'Khách hàng'; }
function paymentName(value?: string) { return value === 'WALLET' ? 'Ví điện tử' : value === 'BANK_TRANSFER' ? 'Chuyển khoản' : value === 'MANUAL' ? 'Thủ công' : value ?? '—'; }
function paramsFor(input: Record<string, string | number>) { const params = new URLSearchParams(); for (const [key, value] of Object.entries(input)) if (value !== '' && value !== undefined) params.set(key, String(value)); return params.toString(); }
function normalizePage<T>(body: PageResult<T>): PageResult<T> { return { items: Array.isArray(body?.items) ? body.items : [], page: Number(body?.page) || 1, limit: Number(body?.limit) || pageSize, total: Number(body?.total) || 0, totalPages: Number(body?.totalPages) || 0 }; }
async function readApiBody<T>(response: Response): Promise<T> { const text = await response.text(); if (!text) return {} as T; try { return JSON.parse(text) as T; } catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` } as T; } }
function messageFromBody(body: unknown, fallback: string) { if (!body || typeof body !== 'object' || !('message' in body)) return fallback; const message = (body as { message?: unknown }).message; return Array.isArray(message) ? message.filter((item): item is string => typeof item === 'string').join('. ') || fallback : typeof message === 'string' ? message : fallback; }
