'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Coins,
  Eye,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Search,
  TriangleAlert,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { TopSpenders } from './top-spenders';

export type AuthorizedRequest = (path: string, init?: RequestInit) => Promise<Response>;
export type OperationsView = 'overview' | 'orders' | 'deposits';

interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Summary {
  generatedAt?: string;
  orders?: { total?: number; today?: number; completed?: number; pendingDelivery?: number };
  revenue?: { total?: number; today?: number };
  deposits?: { total?: number; today?: number; pending?: number };
  users?: { total?: number; newToday?: number };
  inventory?: { available?: number; lowStock?: number };
  recentOrders?: OrderRecord[];
  recentDeposits?: DepositRecord[];
}

interface Person {
  id?: string;
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
  failureReason?: string;
  product?: { id?: string; _id?: string; name?: string; slug?: string } | null;
  user?: Person | null;
}

interface OrderDetail extends OrderRecord {
  updatedAt: string;
  user?: (Person & { status?: string; walletBalance?: number; purchaseCount?: number; createdAt?: string }) | null;
  product?: ({ id?: string; name?: string; slug?: string; description?: string; price?: number; status?: string;
    instructions?: string | null; warrantyPolicy?: string | null; warrantyDays?: number }) | null;
  inventory?: { id: string; status: string; maskedPreview?: Record<string, unknown>; importBatchId?: string | null;
    reservedAt?: string | null; reservationExpiresAt?: string | null; soldAt?: string | null; createdAt?: string; updatedAt?: string } | null;
  walletTransaction?: { id: string; amount: number; balanceBefore: number; balanceAfter: number; type: string;
    reason: string; referenceType: string; referenceId?: string | null; actorType: string; createdAt: string } | null;
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

export function OperationsDashboard({ view, authorized, onOpenCatalog, onOpenInventory, onOpenOrders, onOpenDeposits, setMessage }: {
  view: OperationsView;
  authorized: AuthorizedRequest;
  onOpenCatalog(): void;
  onOpenInventory(): void;
  onOpenOrders(): void;
  onOpenDeposits(): void;
  setMessage(message: string): void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<PageResult<OrderRecord>>(blankPage);
  const [deposits, setDeposits] = useState<PageResult<DepositRecord>>(blankPage);
  const [summaryBusy, setSummaryBusy] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [spendingRefreshVersion, setSpendingRefreshVersion] = useState(0);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [ordersQuery, setOrdersQuery] = useState({ search: '', userId: '', status: '', from: '', to: '', page: 1 });
  const [depositsQuery, setDepositsQuery] = useState({ search: '', userId: '', status: '', provider: '', from: '', to: '', page: 1 });
  const historyRequest = useRef<AbortController | null>(null);
  const urlFilterApplied = useRef(false);

  const loadSummary = useCallback(async (quiet = false, refresh = false) => {
    if (!quiet) setSummaryBusy(true);
    try {
      const response = await authorized(`/admin/analytics/summary${refresh ? '?refresh=1' : ''}`);
      const body = await readApiBody<Summary>(response);
      if (!response.ok) throw new Error(messageFromBody(body, 'Không thể tải thống kê.'));
      setSummary(body);
      setSummaryError('');
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : 'Không thể tải thống kê.');
      setMessage(error instanceof Error ? error.message : 'Không thể tải thống kê.');
    } finally {
      if (!quiet) setSummaryBusy(false);
    }
  }, [authorized, setMessage]);

  const loadOrders = useCallback(async () => {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setHistoryBusy(true);
    try {
      const query = paramsFor({ ...ordersQuery, limit: String(pageSize) });
      const response = await authorized(`/admin/orders?${query}`, { signal: controller.signal });
      const body = await readApiBody<PageResult<OrderRecord>>(response);
      if (!response.ok) throw new Error(messageFromBody(body, 'Không thể tải lịch sử đơn hàng.'));
      if (!controller.signal.aborted) setOrders(normalizePage(body));
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setMessage(error instanceof Error ? error.message : 'Không thể tải lịch sử đơn hàng.');
    } finally {
      if (historyRequest.current === controller) { historyRequest.current = null; setHistoryBusy(false); }
    }
  }, [authorized, ordersQuery, setMessage]);

  const loadDeposits = useCallback(async () => {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setHistoryBusy(true);
    try {
      const query = paramsFor({ ...depositsQuery, limit: String(pageSize) });
      const response = await authorized(`/admin/deposits?${query}`, { signal: controller.signal });
      const body = await readApiBody<PageResult<DepositRecord>>(response);
      if (!response.ok) throw new Error(messageFromBody(body, 'Không thể tải lịch sử nạp tiền.'));
      if (!controller.signal.aborted) setDeposits(normalizePage(body));
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setMessage(error instanceof Error ? error.message : 'Không thể tải lịch sử nạp tiền.');
    } finally {
      if (historyRequest.current === controller) { historyRequest.current = null; setHistoryBusy(false); }
    }
  }, [authorized, depositsQuery, setMessage]);

  useEffect(() => {
    if (urlFilterApplied.current) return;
    urlFilterApplied.current = true;
    const userId = new URL(window.location.href).searchParams.get('userId')?.trim();
    if (!userId) return;
    queueMicrotask(() => {
      setOrdersQuery((current) => ({ ...current, userId, page: 1 }));
      setDepositsQuery((current) => ({ ...current, userId, page: 1 }));
    });
  }, []);

  useEffect(() => { if (view === 'overview') queueMicrotask(() => void loadSummary()); }, [loadSummary, view]);
  useEffect(() => {
    if (view === 'overview') return;
    const timer = window.setTimeout(() => {
      if (view === 'orders') void loadOrders();
      if (view === 'deposits') void loadDeposits();
    }, 250);
    return () => { window.clearTimeout(timer); historyRequest.current?.abort(); };
  }, [loadDeposits, loadOrders, view]);

  const stats = useMemo(() => [
    { label: 'Tổng doanh thu', value: money(summary?.revenue?.total), today: `Hôm nay ${money(summary?.revenue?.today)}`, icon: <CircleDollarSign />, tone: 'indigo' },
    { label: 'Đơn hàng', value: number(summary?.orders?.total), today: `${number(summary?.orders?.today)} đơn hôm nay`, icon: <ClipboardList />, tone: 'sky' },
    { label: 'Nạp tiền', value: money(summary?.deposits?.total), today: `${number(summary?.deposits?.pending)} yêu cầu chờ duyệt`, icon: <WalletCards />, tone: 'emerald' },
    { label: 'Khách hàng', value: number(summary?.users?.total), today: `+${number(summary?.users?.newToday)} khách hôm nay`, icon: <Users />, tone: 'violet' },
  ], [summary]);

  return <section className="space-y-6" aria-label="Vận hành cửa hàng">
    {view === 'overview' && <>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300">Không gian của bạn</p>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">Tổng quan cửa hàng</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Mọi hoạt động kinh doanh, trong một góc nhìn.</p>
        </div>
        <div className="flex gap-2"><button type="button" onClick={() => { void loadSummary(false, true); setSpendingRefreshVersion((value) => value + 1); }} disabled={summaryBusy} className="button-secondary inline-flex shrink-0 items-center justify-center gap-2 px-3 py-2.5">
          <RefreshCw size={15} className={summaryBusy ? 'animate-spin' : ''} /> Làm mới
        </button><button type="button" onClick={onOpenInventory} className="button-primary inline-flex items-center gap-2 py-2.5"><PackageCheck size={16} />Nhập hàng<ArrowUpRight size={15} /></button></div>
      </div>
      {summaryError && <p role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{summaryError}{summary ? ' Đang hiển thị dữ liệu của lần tải trước.' : ' Nhấn Làm mới để thử lại.'}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => <StatCard key={stat.label} {...stat} value={summary ? stat.value : '—'} today={summary ? stat.today : 'Chưa có dữ liệu thống kê'} loading={summaryBusy} />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <FulfillmentOverview summary={summary} loading={summaryBusy} onOrders={onOpenOrders} />
        <div className="admin-card p-5"><p className="mb-4 text-sm font-semibold text-slate-100">Thao tác nhanh</p><div className="space-y-2">
          <QuickAction icon={<PackageCheck size={17} />} title="Quản lý sản phẩm" description="Danh mục và sản phẩm đang bán" action="Mở" onClick={onOpenCatalog} />
          <QuickAction icon={<Coins size={17} />} title="Kho hàng" description={summary ? `${number(summary.inventory?.available)} tài khoản sẵn sàng giao` : 'Xem và bổ sung hàng trong kho'} action="Mở" onClick={onOpenInventory} />
          <QuickAction icon={<TriangleAlert size={17} />} title="Kiểm tra tồn kho" description={summary ? `${number(summary.inventory?.lowStock)} sản phẩm sắp hết hàng` : 'Theo dõi sản phẩm cần nhập thêm'} action="Xem" onClick={onOpenCatalog} danger={Number(summary?.inventory?.lowStock ?? 0) > 0} />
        </div></div>
      </div>
      {summary?.generatedAt && <p className="text-right text-[11px] text-slate-500">Cập nhật lúc {dateTime(summary.generatedAt)}</p>}
    </>}

    {view === 'overview' && <TopSpenders authorized={authorized} refreshVersion={spendingRefreshVersion} />}
    {view === 'overview' && <Overview
      summary={summary}
      loading={summaryBusy}
      onOrders={onOpenOrders}
      onDeposits={onOpenDeposits}
    />}
    {view === 'orders' && <OrdersHistory
      data={orders}
      loading={historyBusy}
      query={ordersQuery}
      setQuery={setOrdersQuery}
      refresh={loadOrders}
      authorized={authorized}
      setMessage={setMessage}
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

function FulfillmentOverview({ summary, loading, onOrders }: { summary: Summary | null; loading: boolean; onOrders(): void }) {
  const total = summary?.orders?.total ?? 0;
  const completed = summary?.orders?.completed ?? 0;
  const pending = summary?.orders?.pendingDelivery ?? 0;
  const remaining = Math.max(0, total - completed - pending);
  const ratio = total > 0 ? Math.min(100, completed / total * 100) : 0;
  const segments = [
    { label: 'Đã giao', count: completed, color: 'bg-indigo-300' },
    { label: 'Chờ / đang giao', count: pending, color: 'bg-amber-300' },
    { label: 'Trạng thái khác', count: remaining, color: 'bg-slate-600' },
  ];
  return <div className="admin-card flex flex-col p-5 sm:p-6" aria-busy={loading}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Tình trạng đơn hàng</h2><button type="button" onClick={onOrders} className="flex items-center gap-1 text-xs text-slate-400 transition hover:text-indigo-300">Chi tiết<ArrowUpRight size={14} /></button></div>
    <div className="my-7 flex flex-wrap items-end gap-x-4 gap-y-2"><span className="text-5xl font-medium tracking-tight text-indigo-300">{summary && total > 0 ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(ratio)}%` : '—'}</span><p className="pb-1 text-xs leading-5 text-slate-400">{summary ? `${number(completed)} / ${number(total)} đơn đã giao` : 'Đang chờ dữ liệu đơn hàng'}<br /><span className="text-slate-500">Tính trên toàn bộ đơn hàng</span></p></div>
    <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">{segments.map((segment) => <span key={segment.label} className={segment.color} style={{ width: total > 0 ? `${segment.count / total * 100}%` : '0%' }} />)}</div>
    <div className="mt-5 grid grid-cols-3 gap-3">{segments.map((segment) => <div key={segment.label}><p className="flex items-center gap-1.5 text-[10px] text-slate-400 sm:text-xs"><span className={`size-1.5 shrink-0 rounded-full ${segment.color}`} />{segment.label}</p><p className="mt-2 text-lg font-medium tabular-nums">{summary ? number(segment.count) : '—'}</p></div>)}</div>
    <p className="mt-auto pt-5 text-[11px] text-slate-500">{!summary ? 'Thống kê sẽ xuất hiện sau khi tải dữ liệu.' : total === 0 ? 'Đơn hàng đầu tiên của bạn sẽ xuất hiện tại đây.' : 'Trạng thái khác gồm đơn lỗi, đã hủy hoặc đã hoàn tiền.'}</p>
  </div>;
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

function OrdersHistory({ data, loading, query, setQuery, refresh, authorized, setMessage }: {
  data: PageResult<OrderRecord>;
  loading: boolean;
  query: { search: string; userId: string; status: string; from: string; to: string; page: number };
  setQuery: Dispatch<SetStateAction<{ search: string; userId: string; status: string; from: string; to: string; page: number }>>;
  refresh(): Promise<void>;
  authorized: AuthorizedRequest;
  setMessage(message: string): void;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  const openDetail = useCallback(async (id: string) => {
    setDetailBusy(id);
    try {
      const response = await authorized(`/admin/orders/${id}`);
      const body = await readApiBody<OrderDetail>(response);
      if (!response.ok) throw new Error(messageFromBody(body, 'Không thể tải chi tiết đơn hàng.'));
      setDetail(body);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tải chi tiết đơn hàng.'); }
    finally { setDetailBusy(null); }
  }, [authorized, setMessage]);

  return <><HistoryPanel title="Lịch sử đơn hàng" subtitle="Bấm vào một đơn để xem khách mua, sản phẩm, thanh toán, hàng giao và hướng dẫn." icon={<ClipboardList size={19} />} loading={loading} refresh={refresh}>
    {query.userId && <ScopedUserFilter userId={query.userId} clear={() => { clearUrlUserFilter(); setQuery((current) => ({ ...current, userId: '', page: 1 })); }} />}
    <FilterBar>
      <SearchField value={query.search} onChange={(search) => setQuery((current) => ({ ...current, search, page: 1 }))} placeholder="Mã đơn, @username, Telegram ID hoặc sản phẩm" />
      <select className="input h-11 py-2" value={query.status} onChange={(event) => setQuery((current) => ({ ...current, status: event.target.value, page: 1 }))} aria-label="Lọc trạng thái đơn hàng">
        <option value="">Tất cả trạng thái</option>
        <option value="PENDING_DELIVERY">Chờ giao</option><option value="DELIVERING">Đang giao</option><option value="DELIVERED">Đã giao</option>
        <option value="DELIVERY_FAILED">Giao lỗi</option><option value="REFUNDED">Đã hoàn tiền</option><option value="CANCELLED">Đã hủy</option>
      </select>
      <DateField label="Từ ngày" value={query.from} onChange={(from) => setQuery((current) => ({ ...current, from, page: 1 }))} />
      <DateField label="Đến ngày" value={query.to} onChange={(to) => setQuery((current) => ({ ...current, to, page: 1 }))} />
    </FilterBar>
    <div className="mt-4 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      {data.items.map((order) => <OrderRow key={order.id} order={order} onOpen={() => void openDetail(order.id)} opening={detailBusy === order.id} />)}
      {!loading && data.items.length === 0 && <EmptyState icon={<ClipboardList />} text="Không tìm thấy đơn hàng phù hợp." />}
      {loading && <LoadingRows />}
    </div>
    <Pagination data={data} onPage={(page) => setQuery((current) => ({ ...current, page }))} />
  </HistoryPanel>{detail && <OrderDetailDialog order={detail} close={() => setDetail(null)} />}</>;
}

function DepositsHistory({ data, loading, query, setQuery, refresh }: {
  data: PageResult<DepositRecord>;
  loading: boolean;
  query: { search: string; userId: string; status: string; provider: string; from: string; to: string; page: number };
  setQuery: Dispatch<SetStateAction<{ search: string; userId: string; status: string; provider: string; from: string; to: string; page: number }>>;
  refresh(): Promise<void>;
}) {
  return <HistoryPanel title="Lịch sử nạp tiền" subtitle="Theo dõi các yêu cầu nạp và trạng thái đã cộng tiền." icon={<WalletCards size={19} />} loading={loading} refresh={refresh}>
    {query.userId && <ScopedUserFilter userId={query.userId} clear={() => { clearUrlUserFilter(); setQuery((current) => ({ ...current, userId: '', page: 1 })); }} />}
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

function OrderRow({ order, compact = false, onOpen, opening = false }: { order: OrderRecord; compact?: boolean; onOpen?: () => void; opening?: boolean }) {
  return <article className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${compact ? 'px-5' : ''} ${onOpen ? 'cursor-pointer transition hover:bg-slate-900/80 focus-within:bg-slate-900/80' : ''}`}
    onClick={onOpen}>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><code className="text-xs font-semibold text-indigo-200">{order.orderCode}</code><StatusBadge value={order.status} type="order" /></div>
      <p className="mt-1 truncate text-sm font-medium text-slate-100">{order.product?.name ?? 'Sản phẩm đã xóa'}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
        <span>Người mua:</span><BuyerIdentity user={order.user} /><span>· {dateTime(order.createdAt)}</span>
        {order.quantity && order.quantity > 1 ? <span>· SL {order.quantity}</span> : null}
      </div>
    </div>
    <div className="flex items-center justify-between gap-3 sm:text-right"><div><p className="font-semibold text-emerald-300">{money(order.totalAmount)}</p><p className="mt-1 text-xs text-slate-500">{paymentName(order.paymentMethod)}</p></div>{onOpen && <button type="button" disabled={opening} onClick={(event) => { event.stopPropagation(); onOpen(); }} className="button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs">{opening ? <LoaderCircle size={14} className="animate-spin" /> : <Eye size={14} />} Chi tiết</button>}</div>
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

function BuyerIdentity({ user }: { user?: Person | null }) {
  if (!user) return <span className="text-slate-400">Khách đã xóa</span>;
  const username = user.username?.replace(/^@+/, '').trim();
  return <>
    {user.displayName && <span className="font-medium text-slate-300">{user.displayName}</span>}
    {username
      ? <a href={`https://t.me/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer"
        onClick={(event) => event.stopPropagation()} className="font-medium text-sky-300 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-200">@{username}</a>
      : <span className="text-amber-300">Không có @username</span>}
    {user.telegramId && <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-indigo-200">ID {user.telegramId}</code>}
  </>;
}

function OrderDetailDialog({ order, close }: { order: OrderDetail; close(): void }) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [close]);
  const preview = Object.entries(order.inventory?.maskedPreview ?? {});
  const username = order.user?.username?.replace(/^@+/, '').trim();
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="order-detail-title" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-900 shadow-2xl sm:rounded-3xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur sm:px-6">
        <div><p className="text-xs font-medium uppercase tracking-wide text-indigo-300">Chi tiết đơn hàng</p><div className="mt-1 flex flex-wrap items-center gap-2"><h3 id="order-detail-title" className="font-mono text-lg font-semibold text-white">{order.orderCode}</h3><StatusBadge value={order.status} type="order" /></div><p className="mt-1 text-xs text-slate-500">Tạo {dateTime(order.createdAt)} · Cập nhật {dateTime(order.updatedAt)}</p></div>
        <button type="button" onClick={close} className="rounded-xl border border-slate-700 p-2 text-slate-400 transition hover:text-white" aria-label="Đóng chi tiết"><X size={18} /></button>
      </header>
      <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-2">
        <DetailCard title="Đơn hàng & sản phẩm" icon={<ClipboardList size={17} />}>
          <DetailLine label="Sản phẩm" value={order.product?.name ?? 'Sản phẩm đã xóa'} />
          {order.product?.description && <p className="rounded-xl bg-slate-950/70 p-3 text-xs leading-5 text-slate-300 whitespace-pre-wrap">{order.product.description}</p>}
          <div className="grid grid-cols-2 gap-2"><Metric label="Số lượng" value={number(order.quantity)} /><Metric label="Đơn giá" value={money(order.unitPrice)} /><Metric label="Tổng tiền" value={money(order.totalAmount)} accent /><Metric label="Thanh toán" value={paymentName(order.paymentMethod)} /></div>
          <DetailLine label="Giao hàng" value={order.deliveryStatus ?? '—'} />
          <DetailLine label="Giao lúc" value={dateTime(order.deliveredAt)} />
          {order.failureReason && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">Lỗi giao hàng: {order.failureReason}</p>}
        </DetailCard>
        <DetailCard title="Khách hàng" icon={<Users size={17} />}>
          <DetailLine label="Tên" value={order.user?.displayName ?? 'Không có tên'} />
          <DetailLine label="Username" value={username ? `@${username}` : 'Không có @username'} />
          <DetailLine label="Telegram ID" value={order.user?.telegramId ?? '—'} mono />
          <div className="grid grid-cols-2 gap-2"><Metric label="Số dư hiện tại" value={money(order.user?.walletBalance)} accent /><Metric label="Tổng lượt mua" value={number(order.user?.purchaseCount)} /></div>
          <div className="flex flex-wrap gap-2">{username && <a href={`https://t.me/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer" className="button-secondary px-3 py-2 text-xs">Mở Telegram</a>}{order.user?.telegramId && <a href={`/admin?view=messages&telegramId=${encodeURIComponent(order.user.telegramId)}`} className="button-secondary px-3 py-2 text-xs">Nhắn qua bot</a>}{order.user?.id && <a href={`/admin?view=ledger&userId=${encodeURIComponent(order.user.id)}`} className="button-secondary px-3 py-2 text-xs">Xem sổ ví</a>}</div>
        </DetailCard>
        <DetailCard title="Thanh toán & sổ ví" icon={<WalletCards size={17} />}>
          {order.walletTransaction ? <><div className="grid grid-cols-2 gap-2"><Metric label="Biến động" value={`${order.walletTransaction.amount > 0 ? '+' : ''}${money(order.walletTransaction.amount)}`} accent={order.walletTransaction.amount > 0} danger={order.walletTransaction.amount < 0} /><Metric label="Loại" value={order.walletTransaction.type} /><Metric label="Số dư trước" value={money(order.walletTransaction.balanceBefore)} /><Metric label="Số dư sau" value={money(order.walletTransaction.balanceAfter)} /></div><DetailLine label="Lý do" value={order.walletTransaction.reason} /><DetailLine label="Mã giao dịch" value={order.walletTransaction.id} mono /><DetailLine label="Ghi nhận" value={dateTime(order.walletTransaction.createdAt)} /></> : <p className="text-sm text-slate-500">Đơn này không có giao dịch ví liên kết.</p>}
        </DetailCard>
        <DetailCard title="Hàng đã giao" icon={<PackageCheck size={17} />}>
          <DetailLine label="Inventory ID" value={order.inventory?.id ?? 'Không còn dữ liệu kho'} mono />
          <DetailLine label="Trạng thái" value={order.inventory?.status ?? '—'} />
          <DetailLine label="Lô nhập" value={order.inventory?.importBatchId ?? '—'} mono />
          <DetailLine label="Bán lúc" value={dateTime(order.inventory?.soldAt ?? undefined)} />
          {preview.length > 0 && <div><p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Dữ liệu che bớt</p><div className="flex flex-wrap gap-2">{preview.map(([key, value]) => <code key={key} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] text-slate-300">{key}: {String(value)}</code>)}</div></div>}
        </DetailCard>
        {(order.product?.instructions || order.product?.warrantyPolicy) && <div className="lg:col-span-2"><DetailCard title="Hướng dẫn & bảo hành" icon={<BookOpen size={17} />}>{order.product.instructions && <div><p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Hướng dẫn sử dụng</p><p className="whitespace-pre-wrap rounded-xl bg-slate-950/70 p-4 text-sm leading-6 text-slate-200">{order.product.instructions}</p></div>}{order.product.warrantyPolicy && <div><p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Chính sách bảo hành {order.product.warrantyDays ? `· ${order.product.warrantyDays} ngày` : ''}</p><p className="whitespace-pre-wrap rounded-xl bg-slate-950/70 p-4 text-sm leading-6 text-slate-200">{order.product.warrantyPolicy}</p></div>}</DetailCard></div>}
      </div>
    </div>
  </div>;
}

function DetailCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) { return <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/45 p-4"><h4 className="flex items-center gap-2 font-medium text-slate-100"><span className="text-indigo-300">{icon}</span>{title}</h4>{children}</section>; }
function DetailLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="flex items-start justify-between gap-4 text-xs"><span className="shrink-0 text-slate-500">{label}</span><span className={`break-all text-right text-slate-200 ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span></div>; }
function Metric({ label, value, accent = false, danger = false }: { label: string; value: string; accent?: boolean; danger?: boolean }) { return <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-sm font-semibold ${danger ? 'text-rose-300' : accent ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</p></div>; }

function QuickAction({ icon, title, description, action, onClick, danger = false }: { icon: ReactNode; title: string; description: string; action: string; onClick(): void; danger?: boolean }) {
  return <button type="button" onClick={onClick} className="group flex w-full items-center gap-3 rounded-xl border border-transparent p-3 text-left transition hover:border-slate-700 hover:bg-slate-950/50">
    <span className={`rounded-lg p-2.5 ${danger ? 'bg-amber-400/10 text-amber-300' : 'bg-slate-800 text-slate-300'}`}>{icon}</span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-100">{title}</span><span className="mt-1 block truncate text-xs text-slate-400">{description}</span></span>
    <span className="flex items-center gap-1 text-xs text-slate-500 group-hover:text-indigo-300">{action}<ChevronRight size={13} /></span>
  </button>;
}

function StatCard({ label, value, today, icon, tone, loading }: { label: string; value: string; today: string; icon: ReactNode; tone: string; loading: boolean }) {
  const tones: Record<string, string> = { indigo: 'bg-indigo-500/12 text-indigo-300', sky: 'bg-sky-500/12 text-sky-300', emerald: 'bg-emerald-500/12 text-emerald-300', violet: 'bg-violet-500/12 text-violet-300' };
  return <div className="dashboard-stat" aria-busy={loading}>
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-slate-400">{label}</p><span className={`rounded-lg p-2 [&>svg]:size-[18px] ${tones[tone]}`}>{icon}</span></div>
    <p className={`mt-5 break-words text-[26px] font-semibold tracking-tight text-white tabular-nums ${loading ? 'animate-pulse opacity-45' : ''}`}>{value}</p>
    <p className="mt-4 border-t border-slate-700/50 pt-3 text-[11px] text-slate-400">{today}</p>
  </div>;
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
function ScopedUserFilter({ userId, clear }: { userId: string; clear(): void }) { return <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100"><span>Lịch sử riêng của khách <code>{userId}</code></span><button type="button" onClick={clear} className="rounded-lg bg-slate-950/60 px-2 py-1 text-indigo-200 hover:text-white">Bỏ lọc</button></div>; }
function clearUrlUserFilter() { const url = new URL(window.location.href); url.searchParams.delete('userId'); window.history.replaceState(window.history.state, '', url); }

function number(value: number | undefined) { return new Intl.NumberFormat('vi-VN').format(value ?? 0); }
function money(value: number | undefined) { return `${number(value)} đ`; }
function dateTime(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
function person(user?: Person | null) { if (!user) return 'Khách đã xóa'; if (user.displayName) return user.displayName; if (user.username) return `@${user.username}`; return user.telegramId ? `Telegram ${user.telegramId}` : 'Khách hàng'; }
function paymentName(value?: string) { return value === 'WALLET' ? 'Ví điện tử' : value === 'BANK_TRANSFER' ? 'Chuyển khoản' : value === 'MANUAL' ? 'Thủ công' : value ?? '—'; }
function paramsFor(input: Record<string, string | number>) { const params = new URLSearchParams(); for (const [key, value] of Object.entries(input)) if (value !== '' && value !== undefined) params.set(key, String(value)); return params.toString(); }
function normalizePage<T>(body: PageResult<T>): PageResult<T> { return { items: Array.isArray(body?.items) ? body.items : [], page: Number(body?.page) || 1, limit: Number(body?.limit) || pageSize, total: Number(body?.total) || 0, totalPages: Number(body?.totalPages) || 0 }; }
async function readApiBody<T>(response: Response): Promise<T> { const text = await response.text(); if (!text) return {} as T; try { return JSON.parse(text) as T; } catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` } as T; } }
function messageFromBody(body: unknown, fallback: string) { if (!body || typeof body !== 'object' || !('message' in body)) return fallback; const message = (body as { message?: unknown }).message; return Array.isArray(message) ? message.filter((item): item is string => typeof item === 'string').join('. ') || fallback : typeof message === 'string' ? message : fallback; }
