'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3, LoaderCircle, RefreshCw, Search, WalletCards, XCircle } from 'lucide-react';
import type { AuthorizedRequest } from './operations-dashboard';

export interface ReconciliationBank {
  id?: string;
  label?: string;
  provider?: string;
  bankId: string;
  accountNo: string;
  accountName?: string;
  source?: string;
  active?: boolean;
}

type ReconciliationStatus = 'MATCHED' | 'AMOUNT_MISMATCH' | 'NOT_CREDITED' | 'UNMATCHED' | 'AMBIGUOUS' | 'OUTGOING' | 'BANK_RECEIVED_REQUEST_REJECTED' | string;
interface PaymentMatch {
  id?: string; requestCode?: string; status?: string; requestedAmount?: number; userId?: string;
  telegramId?: string; username?: string; displayName?: string; rejectionReason?: string;
  providerReference?: string; walletTransactionId?: string;
  metadata?: { amountMismatch?: { expected?: number; received?: number }; quickCheckoutStatus?: string; cancelled?: boolean };
}
interface ReconciliationItem {
  transactionId?: string; transactionID?: string; type?: string; amount?: number; description?: string;
  transactionDate?: string; transactionAt?: string; status?: ReconciliationStatus;
  creditedAmount?: number | null; difference?: number | null; paymentRequests?: PaymentMatch[];
  walletTransactionIds?: string[]; notes?: string[];
}
interface ReconciliationResult {
  bank?: { id?: string; label?: string; provider?: string; bankId?: string; accountNo?: string };
  fetchedAt?: string;
  coverage?: { source?: string; complete?: boolean; limit?: number; rawCount?: number; validCount?: number; discardedCount?: number; returned?: number; truncated?: boolean; invalidDateCount?: number; unknownDateCount?: number; warnings?: string[] };
  summary?: { incomingCount?: number; incomingAmount?: number; outgoingCount?: number; outgoingAmount?: number; creditedAmount?: number; difference?: number; matchedCount?: number; uncreditedCount?: number; mismatchCount?: number; ambiguousCount?: number; unmatchedCount?: number; rejectedReceivedCount?: number; rejectedReceivedAmount?: number };
  items?: ReconciliationItem[]; page?: number; limit?: number; total?: number;
  pagination?: { page?: number; limit?: number; total?: number; totalPages?: number };
}
interface Props { authorized: AuthorizedRequest; banks: ReconciliationBank[]; activeBankId?: string; }

const PAGE_SIZE = 25;
const money = (value: number | null | undefined) => Math.round(Number(value) || 0).toLocaleString('vi-VN') + ' ₫';
const integer = (value: number | null | undefined) => Math.round(Number(value) || 0).toLocaleString('vi-VN');
const dateTime = (value?: string) => {
  if (!value) return 'Không có thời gian';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
};
function requestBankId(bank: ReconciliationBank) {
  if (bank.source === 'environment') return 'environment';
  if (bank.source === 'legacy') return 'legacy';
  return bank.id || ((bank.provider || 'CAKE_V2') + ':' + bank.bankId + ':' + bank.accountNo);
}
function statusLabel(status?: string) {
  switch (status) {
    case 'MATCHED': return 'Khớp đã cộng';
    case 'AMOUNT_MISMATCH': return 'Sai số tiền';
    case 'NOT_CREDITED': return 'Chưa cộng ví';
    case 'UNMATCHED': return 'Chưa ghép đơn';
    case 'AMBIGUOUS': return 'Ghép không chắc chắn';
    case 'OUTGOING': return 'Tiền ra';
    case 'BANK_RECEIVED_REQUEST_REJECTED': return 'Bank đã nhận nhưng nạp bị từ chối';
    case 'BANK_RECEIVED_REQUEST_EXPIRED': return 'Bank nhận sau khi yêu cầu hết hạn';
    case 'BANK_RECEIVED_REQUEST_CANCELLED': return 'Bank nhận sau khi khách hủy';
    case 'DUPLICATE': return 'Giao dịch trùng';
    default: return status || 'Chưa xác định';
  }
}
function statusClass(status?: string) {
  if (status === 'MATCHED') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200';
  if (status === 'AMOUNT_MISMATCH' || status === 'NOT_CREDITED') return 'border-amber-400/20 bg-amber-400/10 text-amber-200';
  if (status === 'OUTGOING') return 'border-slate-600 bg-slate-800/70 text-slate-400';
  return 'border-rose-400/20 bg-rose-400/10 text-rose-200';
}
function StatusIcon({ status }: { status?: string }) {
  if (status === 'MATCHED') return <CheckCircle2 size={14} aria-hidden="true" />;
  if (status === 'OUTGOING') return <Clock3 size={14} aria-hidden="true" />;
  if (status === 'AMBIGUOUS' || status === 'UNMATCHED') return <CircleHelp size={14} aria-hidden="true" />;
  return <XCircle size={14} aria-hidden="true" />;
}
function isResult(value: unknown): value is ReconciliationResult { return Boolean(value && typeof value === 'object'); }

export function BankReconciliation({ authorized, banks, activeBankId }: Props) {
  const availableBanks = useMemo(() => banks.filter((bank) => bank.bankId && bank.accountNo), [banks]);
  const preferredBank = availableBanks.find((bank) => requestBankId(bank) === activeBankId || bank.id === activeBankId) || availableBanks.find((bank) => bank.active) || availableBanks[0];
  const [selectedBank, setSelectedBank] = useState('');
  const [search, setSearch] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); const [data, setData] = useState<ReconciliationResult | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [page, setPage] = useState(1);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const selectedBankId = availableBanks.some((bank) => requestBankId(bank) === selectedBank) ? selectedBank : (preferredBank ? requestBankId(preferredBank) : '');
  const items = useMemo(() => Array.isArray(data && data.items) ? data!.items! : [], [data]);
  const queryFilteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const dateOnly = (value?: string) => {
      const raw = String(value ?? '').trim();
      const vietnamese = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);
      if (vietnamese) return `${vietnamese[3]}-${vietnamese[2]}-${vietnamese[1]}`;
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
    };
    return items.filter((item) => {
      const match = item.paymentRequests || [];
      const text = [item.transactionId, item.transactionID, item.description, ...match.flatMap((request) => [request.requestCode, request.providerReference, request.username, request.displayName])].filter(Boolean).join(' ').toLowerCase();
      if (needle && !text.includes(needle)) return false;
      if (from || to) {
        const dateValue = item.transactionAt || item.transactionDate;
        if (!dateValue) return false;
        const day = dateOnly(dateValue);
        if (!day) return false;
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      return true;
    });
  }, [from, items, search, to]);
  const filteredItems = useMemo(() => statusFilter === 'ALL' ? queryFilteredItems : queryFilteredItems.filter((item) => item.status === statusFilter), [queryFilteredItems, statusFilter]);
  const localPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const totalPages = localPages;
  const visibleItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const serverTotal = queryFilteredItems.length;
  const summary = useMemo(() => {
    if (!data) return {};
    const scoped = filteredItems;
    if (!search.trim() && !from && !to && statusFilter === 'ALL') return data.summary || {};
    const incoming = scoped.filter((item) => item.type !== 'OUT');
    const outgoing = scoped.filter((item) => item.type === 'OUT');
    const count = (status: string) => scoped.filter((item) => item.status === status).length;
    const credited = incoming.reduce((sum, item) => sum + (item.creditedAmount || 0), 0);
    return { incomingCount: incoming.length, incomingAmount: incoming.reduce((sum, item) => sum + (item.amount || 0), 0), outgoingCount: outgoing.length, outgoingAmount: outgoing.reduce((sum, item) => sum + (item.amount || 0), 0), creditedAmount: credited, difference: incoming.reduce((sum, item) => sum + (item.difference || 0), 0), matchedCount: count('MATCHED'), uncreditedCount: incoming.filter((item) => (item.creditedAmount || 0) === 0).length, mismatchCount: count('AMOUNT_MISMATCH'), ambiguousCount: scoped.filter((item) => item.status === 'AMBIGUOUS' || item.status === 'DUPLICATE').length, unmatchedCount: count('UNMATCHED'), rejectedReceivedCount: count('BANK_RECEIVED_REQUEST_REJECTED'), rejectedReceivedAmount: scoped.filter((item) => item.status === 'BANK_RECEIVED_REQUEST_REJECTED').reduce((sum, item) => sum + (item.amount || 0), 0) };
  }, [data, filteredItems, from, queryFilteredItems, search, statusFilter, to]);

  async function runQuery(event?: FormEvent, requestedPage = 1) {
    if (event) event.preventDefault();
    if (!selectedBankId) { setError('Hãy chọn một tài khoản ngân hàng đã lưu.'); return; }
    if (from && to && from > to) { setError('Ngày bắt đầu phải trước hoặc cùng ngày kết thúc.'); return; }
    if (requestRef.current) requestRef.current.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setLoading(true); setError(''); setPage(requestedPage); setData(null);
    try {
      const response = await authorized('/admin/payments/bank/reconcile', { method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bankConfigId: selectedBankId }) });
      const body: unknown = await response.json().catch(() => null);
      const message = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string' ? (body as { message: string }).message : 'Không truy vấn được lịch sử ngân hàng.';
      if (!response.ok || !isResult(body)) throw new Error(message);
      if (!controller.signal.aborted) setData(body);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Không truy vấn được lịch sử ngân hàng.');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function changePage(next: number) {
    if (next < 1 || next > totalPages || loading) return;
    setPage(next);
  }

  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/10" aria-labelledby="bank-reconciliation-title">
    <div className="border-b border-slate-800 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><WalletCards size={19} className="text-indigo-300" /><h2 id="bank-reconciliation-title" className="text-lg font-semibold text-slate-100">Đối soát tiền ngân hàng</h2></div><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Tra cứu thủ công lịch sử mà API ngân hàng trả về và so sánh với số tiền shop đã ghi nhận vào ví. Không tự cộng tiền và không tự đồng bộ.</p></div>{data && data.fetchedAt && <p className="text-[11px] text-slate-500">Lần tra cứu: {dateTime(data.fetchedAt)}</p>}</div>
      {availableBanks.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-5 text-sm text-slate-400">Chưa có tài khoản ngân hàng đã lưu. Hãy thêm cấu hình ở phần bên dưới trước khi tra cứu.</div> : <form onSubmit={(event) => void runQuery(event)} className="mt-5 space-y-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]"><label><span className="label">Tài khoản ngân hàng</span><select className="input" value={selectedBankId} onChange={(event) => { setSelectedBank(event.target.value); setData(null); setError(''); }} aria-label="Tài khoản dùng để đối soát"><option value="">Chọn tài khoản</option>{availableBanks.map((item) => <option key={requestBankId(item)} value={requestBankId(item)}>{item.label || item.bankId} · {item.accountNo}{item.active ? ' · đang bật' : ''}</option>)}</select></label><label><span className="label">Từ ngày (tùy chọn)</span><input className="input" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label><label><span className="label">Đến ngày (tùy chọn)</span><input className="input" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label></div>
        <div className="flex flex-col gap-3 md:flex-row"><label className="relative min-w-0 flex-1"><span className="label">Tìm mã giao dịch, nội dung hoặc mã nạp</span><Search size={15} className="pointer-events-none absolute left-3 top-[35px] text-slate-500" /><input className="input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="VD: NAP-..., mã giao dịch, nội dung chuyển khoản" /></label><div className="flex items-end gap-2"><button type="submit" disabled={loading || !selectedBankId} className="button-primary inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{loading ? 'Đang tra cứu…' : 'Tra cứu ngân hàng'}</button>{data && <button type="button" disabled={loading} className="button-secondary inline-flex h-10 items-center gap-2" onClick={() => void runQuery(undefined, 1)}><RefreshCw size={15} />Tra cứu lại</button>}</div></div>
        <p className="text-[11px] leading-5 text-slate-500">Mỗi lần bấm nút sẽ gọi API ngân hàng một lần. Kết quả chỉ là phần lịch sử gần đây nhà cung cấp trả về; không đại diện cho số dư hoặc toàn bộ sao kê tài khoản.</p>
      </form>}
      {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-xs leading-5 text-rose-200"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</div>}
    </div>
    {loading && <div role="status" className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-slate-400"><LoaderCircle size={18} className="animate-spin" />Đang gọi API lịch sử ngân hàng…</div>}
    {!loading && data && <><div className="grid gap-3 border-b border-slate-800 p-5 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Tiền vào ngân hàng" value={integer(summary.incomingCount) + ' giao dịch'} detail={money(summary.incomingAmount)} tone="text-cyan-200" /><Metric label="Shop đã cộng vào ví" value={money(summary.creditedAmount)} detail={integer(summary.matchedCount) + ' giao dịch khớp'} tone="text-emerald-200" /><Metric label="Bank nhận nhưng bị từ chối" value={money(summary.rejectedReceivedAmount)} detail={integer(summary.rejectedReceivedCount) + ' giao dịch'} tone="text-rose-200" /><Metric label="Chưa khớp / chưa cộng" value={money((summary.incomingAmount || 0) - (summary.creditedAmount || 0))} detail={integer((summary.uncreditedCount || 0) + (summary.unmatchedCount || 0) + (summary.ambiguousCount || 0)) + ' dòng cần xem'} tone="text-amber-200" /><Metric label="Chênh lệch đối soát" value={money(summary.difference)} detail={integer(summary.mismatchCount) + ' giao dịch sai số tiền'} tone={Number(summary.difference) === 0 ? 'text-emerald-200' : 'text-rose-200'} /></div>
      <div className="border-b border-slate-800 bg-slate-950/30 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-200">Chi tiết giao dịch</h3><p className="mt-1 text-[11px] text-slate-500">{integer(serverTotal)} dòng theo bộ lọc · hiển thị {visibleItems.length} dòng · tiền ra: {money(summary.outgoingAmount)} ({integer(summary.outgoingCount)} giao dịch)</p></div><label className="flex items-center gap-2 text-xs text-slate-400">Trạng thái<select className="input !w-auto !py-1.5 text-xs" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="ALL">Tất cả</option><option value="MATCHED">Khớp đã cộng</option><option value="AMOUNT_MISMATCH">Sai số tiền</option><option value="NOT_CREDITED">Chưa cộng ví</option><option value="BANK_RECEIVED_REQUEST_REJECTED">Bank nhận · bị từ chối</option><option value="BANK_RECEIVED_REQUEST_EXPIRED">Bank nhận · hết hạn</option><option value="BANK_RECEIVED_REQUEST_CANCELLED">Bank nhận · đã hủy</option><option value="UNMATCHED">Chưa ghép đơn</option><option value="DUPLICATE">Giao dịch trùng</option><option value="AMBIGUOUS">Không chắc chắn</option><option value="OUTGOING">Tiền ra</option></select></label></div>
        {data.coverage && <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[11px] leading-5 text-amber-100"><div className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{data.coverage.truncated || data.coverage.complete === false ? 'API chỉ trả về lịch sử gần đây (tối đa ' + integer(data.coverage.limit || 500) + ' dòng), không phải sao kê đầy đủ.' : 'API trả về đầy đủ phạm vi được yêu cầu.'} {(data.coverage.unknownDateCount || data.coverage.invalidDateCount) ? integer(data.coverage.unknownDateCount || data.coverage.invalidDateCount) + ' dòng không có ngày hợp lệ nên không thể lọc chính xác.' : ''}</span></div>{data.coverage.warnings && data.coverage.warnings.map((warning) => <p key={warning} className="mt-1 pl-5 text-amber-200/80">{warning}</p>)}</div>}
        {visibleItems.length === 0 ? <div className="py-12 text-center text-sm text-slate-500"><p>Không có giao dịch trong phạm vi này.</p><p className="mt-1 text-xs">Có thể giao dịch chưa nằm trong phần lịch sử API trả về hoặc chưa được ghép vào đơn.</p></div> : <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3 font-medium">Thời gian / giao dịch</th><th className="px-4 py-3 font-medium">Ngân hàng trả về</th><th className="px-4 py-3 font-medium">Shop ghi nhận</th><th className="px-4 py-3 font-medium">Trạng thái</th><th className="px-4 py-3 font-medium">Mã nạp / ghi chú</th></tr></thead><tbody className="divide-y divide-slate-800/70">{visibleItems.map((item, index) => <ReconciliationRow key={(item.transactionId || item.transactionID || 'row') + ':' + index} item={item} />)}</tbody></table></div>}
        {totalPages > 1 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-slate-500">Trang {page} / {totalPages}</p><div className="flex items-center gap-2"><button type="button" className="button-secondary !p-2" disabled={page <= 1 || loading} onClick={() => changePage(page - 1)} aria-label="Trang trước"><ChevronLeft size={15} /></button><button type="button" className="button-secondary !p-2" disabled={page >= totalPages || loading} onClick={() => changePage(page + 1)} aria-label="Trang sau"><ChevronRight size={15} /></button></div></div>}</div></>}
    {!loading && !data && !error && availableBanks.length > 0 && <div className="px-5 py-10 text-center text-xs text-slate-500">Chọn tài khoản rồi bấm <span className="text-slate-300">Tra cứu ngân hàng</span> để bắt đầu.</div>}
  </section>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"><p className="text-[11px] text-slate-500">{label}</p><p className={'mt-2 text-lg font-semibold tabular-nums ' + tone}>{value}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>; }

function ReconciliationRow({ item }: { item: ReconciliationItem }) {
  const status = item.status || 'UNKNOWN'; const transactionId = item.transactionId || item.transactionID || 'Không có mã'; const matches = item.paymentRequests || [];
  const bankReceivedIssue = status === 'BANK_RECEIVED_REQUEST_REJECTED' || status === 'BANK_RECEIVED_REQUEST_EXPIRED' || status === 'BANK_RECEIVED_REQUEST_CANCELLED';
  return <tr className="align-top hover:bg-slate-800/20"><td className="px-4 py-4"><p className="whitespace-nowrap text-slate-300">{dateTime(item.transactionAt || item.transactionDate)}</p><code className="mt-1 block break-all text-[11px] text-indigo-300">{transactionId}</code></td><td className="max-w-[320px] px-4 py-4"><p className={'font-semibold tabular-nums ' + (item.type === 'OUT' ? 'text-slate-400' : 'text-cyan-200')}>{item.type === 'OUT' ? '−' : '+'}{money(item.amount)}</p><p className="mt-1 whitespace-pre-wrap break-words leading-5 text-slate-400">{item.description || 'Không có nội dung'}</p></td><td className="px-4 py-4"><p className="font-semibold tabular-nums text-emerald-200">{item.creditedAmount == null ? 'Chưa xác định' : money(item.creditedAmount)}</p>{bankReceivedIssue && <p className="mt-1 font-medium text-rose-200">Bank đã nhận nhưng lịch sử nạp bị từ chối / không được cộng</p>}{item.difference != null && item.difference !== 0 && <p className="mt-1 text-[11px] text-amber-200">Lệch {money(item.difference)}</p>}{matches.slice(0, 3).map((match) => <div key={match.id || match.requestCode} className="mt-2 max-w-[260px] text-[11px] text-slate-500"><p className="truncate font-mono" title={match.requestCode || match.id}>{match.requestCode || match.id || 'Đơn không có mã'} · {match.status || '—'}</p>{bankReceivedIssue && match.rejectionReason && <p className="break-words text-rose-200/80">Lý do từ chối: {match.rejectionReason}</p>}{bankReceivedIssue && match.requestedAmount != null && <p className="text-slate-500">Số tiền yêu cầu: {money(match.requestedAmount)}</p>}{match.metadata && match.metadata.amountMismatch && <p className="text-amber-200/80">Yêu cầu {money(match.metadata.amountMismatch.expected)} · nhận {money(match.metadata.amountMismatch.received)}</p>}</div>)}</td><td className="px-4 py-4"><span className={'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ' + statusClass(status)}><StatusIcon status={status} />{statusLabel(status)}</span>{matches.length > 1 && <p className="mt-2 text-[11px] text-rose-200">Có {matches.length} khả năng ghép</p>}</td><td className="max-w-[260px] px-4 py-4 text-[11px] leading-5 text-slate-500">{item.notes && item.notes.length ? item.notes.map((note) => <p key={note}>{note}</p>) : matches[0] && (matches[0].displayName || matches[0].username || matches[0].telegramId) || '—'}</td></tr>;
}
