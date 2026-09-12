'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Bot, Boxes, CheckCircle2, CircleDollarSign, Eye, FileUp, Info, KeyRound, LayoutDashboard,
  ListChecks, LogOut, MessagesSquare, MessageSquareWarning, Package, QrCode, RefreshCw, ServerCog, ShoppingCart,
  Tags, TriangleAlert, Users, WalletCards, X } from 'lucide-react';
import { inventoryPatternExample, parseInventoryPatternLine, parseInventoryPatternTemplate } from '@store/shared';
import { CategoryManager } from './category-manager';
import { ComplaintManager } from './complaint-manager';
import { InventoryManager } from './inventory-manager';
import { ManagementHub } from './management-hub';
import { MessageCenter } from './message-center';
import { OperationsDashboard } from './operations-dashboard';
import { ProductManager, type CategoryRecord, type ProductPagination, type ProductRecord } from './product-manager';
import { requestId } from './request-id';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface Tokens { accessToken: string; refreshToken?: string; }
interface ImportReport {
  batchId?: string; totalRows: number; validRows: number; invalidRows: number; duplicateRows: number;
  overwriteableRows?: number; importedRows?: number; overwrittenRows?: number;
  preview?: Array<{ line: number; maskedPreview: Record<string, unknown> }>;
  errors?: Array<{ line: number; reason: string }>; skipped?: Array<{ line: number; reason: string }>;
  restockNotificationQueued?: boolean;
}
interface BankConfig {
  configured: boolean; source?: string; maskedToken?: string; bankId: string; accountNo: string; template: string;
  accountName: string; amount: number; description: string; qrUrl?: string; updatedAt?: string;
}
interface BankOption { name: string; code: string; bin: string; shortName: string; }
interface BankQueryTest {
  ok: boolean; provider: string; endpoint: string; latencyMs: number; totalTransactions: number;
  incomingTransactions: number;
  transactions: Array<{
    transactionID: string; amount: number; description: string; transactionDate?: string; type: string;
  }>;
}
interface RuntimeConfig {
  shopName: string; adminTelegramIds: string; apiUrl: string; telegramWebhookUrl: string;
  qstashUrl: string; taskBaseUrl: string; qstashConfigured?: boolean; qstashSource?: string;
  maskedQstashToken?: string; updatedAt?: string;
}
interface RevealedInventory {
  productId: string;
  inventoryPattern: string;
  formatted: string;
}
interface BotConfig {
  configured: boolean; source?: string; botId?: number; botUsername?: string; maskedToken?: string;
  encryptionKeyVersion?: number; updatedAt?: string; reloadWithinSeconds?: number; welcomeMessage?: string;
  bank?: BankConfig; runtime?: RuntimeConfig;
}
type AdminSection = 'dashboard' | 'orders' | 'reports' | 'deposits' | 'users' | 'categories' | 'products' | 'inventory'
  | 'messages' | 'ledger' | 'audit' | 'bot' | 'payments' | 'system';
type FlashMessageKind = 'success' | 'error' | 'warning' | 'info';
interface FlashMessageState { id: number; text: string; kind: FlashMessageKind; }
const flashDurationMs = 6_000;

export default function AdminPage() {
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const refreshInFlight = useRef<Promise<Tokens> | null>(null);
  const sessionRestored = useRef(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [productId, setProductId] = useState(''); const [source, setSource] = useState('');
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [productPage, setProductPage] = useState(1);
  const [pagination, setPagination] = useState<ProductPagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [report, setReport] = useState<ImportReport | null>(null); const [busy, setBusy] = useState(false);
  const [inventoryVersion, setInventoryVersion] = useState(0);
  const [itemId, setItemId] = useState(''); const [payload, setPayload] = useState<RevealedInventory | null>(null);
  const [botConfig, setBotConfig] = useState<BotConfig | null>(null); const [botToken, setBotToken] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [bankToken, setBankToken] = useState(''); const [bankId, setBankId] = useState('');
  const [bankAccountNo, setBankAccountNo] = useState(''); const [bankTemplate, setBankTemplate] = useState('compact2');
  const [bankAccountName, setBankAccountName] = useState(''); const [bankAmount, setBankAmount] = useState(0);
  const [bankDescription, setBankDescription] = useState(''); const [bankOptions, setBankOptions] = useState<BankOption[]>([]);
  const [bankQueryTest, setBankQueryTest] = useState<BankQueryTest | null>(null);
  const [bankTesting, setBankTesting] = useState(false);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({ shopName: 'Digital Store', adminTelegramIds: '',
    apiUrl: '', telegramWebhookUrl: '', qstashUrl: 'https://qstash.upstash.io', taskBaseUrl: '' });
  const [qstashToken, setQstashToken] = useState('');
  const [botBusy, setBotBusy] = useState(false);
  const [flash, setFlash] = useState<FlashMessageState | null>(null);
  const [flashRemainingMs, setFlashRemainingMs] = useState(flashDurationMs);
  const [section, setSection] = useState<AdminSection>('dashboard');
  const selectedProduct = products.find((product) => product._id === productId);

  const setMessage = useCallback((text: string, kind?: FlashMessageKind) => {
    const normalized = text.trim();
    if (normalized) setFlashRemainingMs(flashDurationMs);
    setFlash((current) => normalized
      ? { id: (current?.id ?? 0) + 1, text: normalized, kind: kind ?? flashMessageKind(normalized) }
      : null);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const activeId = flash.id;
    const expiresAt = Date.now() + flashDurationMs;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, expiresAt - Date.now());
      setFlashRemainingMs(remaining);
      if (remaining === 0) {
        window.clearInterval(timer);
        setFlash((current) => current?.id === activeId ? null : current);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [flash]);

  const navigate = useCallback((next: AdminSection) => {
    setSection(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href); url.searchParams.set('view', next);
      url.searchParams.delete('userId');
      if (next !== 'messages') url.searchParams.delete('telegramId');
      window.history.pushState({ view: next }, '', url);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const persistTokens = useCallback((next: Tokens) => {
    const safe = { accessToken: next.accessToken };
    setTokens(safe); sessionStorage.setItem('store-admin-tokens', JSON.stringify(safe));
    return safe;
  }, []);

  const logout = useCallback(() => {
    void fetch(`${apiBase}/admin/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);
    setTokens(null); sessionStorage.removeItem('store-admin-tokens');
  }, []);

  const refreshSession = useCallback(async (legacyRefreshToken?: string) => {
    if (!refreshInFlight.current) {
      refreshInFlight.current = (async () => {
        const response = await fetch(`${apiBase}/admin/auth/refresh`, { method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(legacyRefreshToken ? { refreshToken: legacyRefreshToken } : {}) });
        const body = await readApiBody(response) as Partial<Tokens>;
        if (!response.ok || !body.accessToken) throw new Error(apiErrorMessage(body, 'Session expired'));
        return persistTokens({ accessToken: body.accessToken });
      })().finally(() => { refreshInFlight.current = null; });
    }
    return refreshInFlight.current;
  }, [persistTokens]);

  const authorized = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!tokens) throw new Error('Login required');
    let response = await fetch(`${apiBase}${path}`, { ...init, credentials: 'include', headers: { ...init.headers, authorization: `Bearer ${tokens.accessToken}` } });
    if (response.status === 401) {
      let next: Tokens;
      try { next = await refreshSession(tokens.refreshToken); }
      catch { logout(); throw new Error('Session expired'); }
      response = await fetch(`${apiBase}${path}`, { ...init, credentials: 'include', headers: { ...init.headers, authorization: `Bearer ${next.accessToken}` } });
    }
    return response;
  }, [logout, refreshSession, tokens]);

  const loadProducts = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ page: String(productPage), limit: '20' });
    const response = await authorized(`/admin/products?${query}`, { signal });
    const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Không thể tải sản phẩm');
    // Keep compatibility with older API images that returned a bare array.
    const items = Array.isArray(body) ? body as ProductRecord[] : Array.isArray(body?.items) ? body.items as ProductRecord[] : [];
    const nextPagination = !Array.isArray(body) && body?.pagination ? body.pagination as ProductPagination : {
      page: productPage, limit: 20, total: items.length, totalPages: items.length ? 1 : 0,
    };
    if (nextPagination.totalPages > 0 && productPage > nextPagination.totalPages) {
      setProductPage(nextPagination.totalPages);
      return;
    }
    setProducts(items); setPagination(nextPagination);
    setProductId((current) => items.some((product) => product._id === current) ? current : items[0]?._id ?? '');
  }, [authorized, productPage]);

  const loadCategories = useCallback(async (signal?: AbortSignal) => {
    const response = await authorized('/admin/categories?limit=100', { signal });
    const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Không thể tải danh mục');
    setCategories(Array.isArray(body) ? body as CategoryRecord[] : Array.isArray(body?.items) ? body.items as CategoryRecord[] : []);
  }, [authorized]);

  useEffect(() => {
    if (sessionRestored.current) return;
    sessionRestored.current = true;
    try {
      const stored = sessionStorage.getItem('store-admin-tokens');
      if (stored) {
        const parsed = JSON.parse(stored) as Tokens;
        if (parsed.accessToken) { queueMicrotask(() => setTokens(parsed)); return; }
      }
    } catch { sessionStorage.removeItem('store-admin-tokens'); }
    queueMicrotask(() => void refreshSession().catch(() => undefined));
  }, [refreshSession]);

  useEffect(() => {
    const sync = () => setSection(adminSectionFromLocation());
    sync(); window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    const controller = new AbortController();
    queueMicrotask(() => void Promise.all([loadProducts(controller.signal), loadCategories(controller.signal)])
      .catch((error) => { if (error instanceof Error && error.name !== 'AbortError') setMessage(error.message); }));
    return () => controller.abort();
  }, [loadCategories, loadProducts, setMessage, tokens?.accessToken]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch(`${apiBase}/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ email, password }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Login failed');
      if (!body.accessToken) throw new Error('Login response did not include an access token');
      persistTokens(body as Tokens); setPassword('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Login failed'); }
    finally { setBusy(false); }
  }

  function parseRows() {
    const trimmed = source.trim(); if (!trimmed) throw new Error('Hãy dán ít nhất một dòng hàng.');
    if (trimmed.startsWith('[')) return JSON.parse(trimmed) as Record<string, unknown>[];
    if (trimmed.startsWith('{')) return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    if (!selectedProduct) throw new Error('Hãy chọn sản phẩm trước khi nhập theo pattern.');
    return parsePatternRows(trimmed, inventoryPatternFor(selectedProduct));
  }

  async function importRows(commit: boolean) {
    setBusy(true); setMessage('');
    try {
      const rows = parseRows();
      let overwriteDuplicates = false;
      if (commit) {
        const previewResponse = await authorized('/admin/inventory/import/preview', { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId, rows }) });
        const preview = await previewResponse.json() as ImportReport & { message?: string };
        if (!previewResponse.ok) throw new Error(preview.message ?? 'Không thể kiểm tra dữ liệu trùng');
        if (preview.duplicateRows > 0) {
          const overwriteable = preview.overwriteableRows ?? 0;
          const protectedRows = Math.max(0, preview.duplicateRows - overwriteable);
          const confirmed = window.confirm(`Phát hiện ${preview.duplicateRows} dòng trùng. ` +
            `Hệ thống sẽ ghi đè ${overwriteable} dòng còn “Có sẵn”` +
            `${protectedRows ? ` và bỏ qua ${protectedRows} dòng đã bán/đang giữ hoặc trùng trong tệp` : ''}. Bạn có muốn tiếp tục?`);
          if (!confirmed) {
            setReport(preview); setMessage('Đã hủy nhập kho; chưa có dữ liệu nào bị thay đổi.'); return;
          }
          overwriteDuplicates = true;
        }
      }
      const response = await authorized(`/admin/inventory/import${commit ? '' : '/preview'}`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId, rows, sourceName: 'admin-web.jsonl', overwriteDuplicates }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Import failed');
      setReport(body); setMessage(commit
        ? `Đã nhập ${body.importedRows} hàng mới${body.overwrittenRows ? ` và ghi đè ${body.overwrittenRows} hàng trùng` : ''}` +
          `${body.restockNotificationQueued ? '; đã xếp hàng thông báo “hàng đã về” cho khách.' : '.'}`
        : 'Đã tạo bản xem trước; chưa lưu dữ liệu.');
      if (commit) { await loadProducts(); setInventoryVersion((version) => version + 1); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed'); }
    finally { setBusy(false); }
  }

  async function reveal(targetItemId = itemId) {
    setBusy(true); setPayload(null); setMessage('');
    try {
      const id = targetItemId.trim(); if (!id) throw new Error('Hãy chọn một hàng trong kho.');
      setItemId(id);
      const response = await authorized(`/admin/inventory/${id}/payload`, { headers: { 'x-request-id': requestId() } });
      const body = await response.json() as RevealedInventory & { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Access denied');
      setPayload(body); setMessage('Đã tải và định dạng dữ liệu kho. Lượt xem đã được ghi vào nhật ký.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to read item'); }
    finally { setBusy(false); }
  }

  const loadBankOptions = useCallback(async () => {
    try {
      const response = await authorized('/admin/bot-config/banks');
      const body = await response.json() as BankOption[]; if (response.ok && Array.isArray(body)) setBankOptions(body);
    } catch { /* QR settings remain usable with a manually entered BANK_ID. */ }
  }, [authorized]);

  const loadBotConfig = useCallback(async () => {
    setBotBusy(true); setMessage('');
    try {
      const response = await authorized('/admin/bot-config');
      const body = (await readApiBody(response)) as BotConfig; if (!response.ok) throw new Error(apiErrorMessage(body, 'Không thể tải cấu hình bot'));
      setBotConfig(body);
      setWelcomeMessage(body.welcomeMessage ?? '');
      setBankToken(''); setBankId(body.bank?.bankId ?? ''); setBankAccountNo(body.bank?.accountNo ?? '');
      setBankTemplate(body.bank?.template ?? 'compact2'); setBankAccountName(body.bank?.accountName ?? '');
      setBankAmount(body.bank?.amount ?? 0); setBankDescription(body.bank?.description ?? '');
      if (body.runtime) setRuntimeConfig(runtimeWithPublicDefaults(body.runtime));
      setQstashToken('');
      await loadBankOptions();
      setMessage(body.configured ? 'Đã tải trạng thái bot.' : 'Chưa có token Telegram nào được lưu.', body.configured ? 'success' : 'warning');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải cấu hình bot', 'error');
    }
    finally { setBotBusy(false); }
  }, [authorized, loadBankOptions, setMessage]);

  useEffect(() => {
    if (tokens?.accessToken) queueMicrotask(() => void loadBotConfig());
  }, [loadBotConfig, tokens?.accessToken]);

  async function saveWelcomeMessage(event: FormEvent) {
    event.preventDefault(); setBotBusy(true); setMessage('');
    try {
      const message = welcomeMessage.trim();
      if (!message) throw new Error('Hãy nhập lời chào cho bot.');
      const response = await authorized('/admin/bot-config/welcome', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() }, body: JSON.stringify({ message }) });
      const body = (await readApiBody(response)) as Partial<BotConfig>; if (!response.ok) throw new Error(apiErrorMessage(body, 'Không thể lưu lời chào'));
      setBotConfig((current) => current ? { ...current, ...body, welcomeMessage: message } : { configured: false, ...body, welcomeMessage: message });
      setMessage(`Đã lưu lời chào. Bot sẽ nạp nội dung mới trong tối đa ${body.reloadWithinSeconds ?? 15} giây.`, 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu lời chào', 'error');
    }
    finally { setBotBusy(false); }
  }

  async function saveBotToken(event: FormEvent) {
    event.preventDefault(); setBotBusy(true); setMessage('');
    try {
      const token = normalizeBotToken(botToken);
      if (!token) throw new Error('Hãy nhập token Telegram từ @BotFather.');
      const response = await authorized('/admin/bot-config/token', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify({ token }) });
      const body = (await readApiBody(response)) as BotConfig; if (!response.ok) throw new Error(apiErrorMessage(body, 'Token Telegram không hợp lệ'));
      setBotConfig((current) => current ? { ...current, ...body } : body); setBotToken('');
      setMessage(`Đã lưu token. Bot @${body.botUsername ?? body.botId} sẽ tự nạp lại trong tối đa ${body.reloadWithinSeconds} giây.`, 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể cập nhật token', 'error');
    }
    finally { setBotBusy(false); }
  }

  async function saveBankConfig(event: FormEvent) {
    event.preventDefault(); setBotBusy(true); setMessage('');
    try {
      if (!bankId.trim() || !bankAccountNo.trim() || !bankAccountName.trim()) throw new Error('Hãy nhập đủ mã ngân hàng, số tài khoản và tên tài khoản.');
      const response = await authorized('/admin/bot-config/bank', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify({ tokenApiBank: bankToken.trim(), bankId: bankId.trim(), accountNo: bankAccountNo.trim(),
          template: bankTemplate, accountName: bankAccountName.trim(), amount: bankAmount, description: bankDescription.trim() }), });
      const body = (await readApiBody(response)) as { bank?: BankConfig; reloadWithinSeconds?: number; message?: string };
      if (!response.ok || !body.bank) throw new Error(apiErrorMessage(body, 'Không thể lưu cấu hình ngân hàng'));
      setBotConfig((current) => current ? { ...current, bank: body.bank } : { configured: false, bank: body.bank });
      setBankToken(''); setMessage('Đã lưu cấu hình VietQR. Token ngân hàng được mã hóa và không hiển thị lại.', 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu cấu hình ngân hàng', 'error');
    }
    finally { setBotBusy(false); }
  }

  async function testBankQuery() {
    setBankTesting(true); setBankQueryTest(null); setMessage('');
    try {
      const response = await authorized('/admin/payments/bank/test', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() }, body: '{}' });
      const body = (await readApiBody(response)) as BankQueryTest & { message?: string };
      if (!response.ok || !body.ok) throw new Error(apiErrorMessage(body, 'Không truy vấn được API Cake'));
      setBankQueryTest(body);
      setMessage(`API Cake hoạt động: nhận ${body.totalTransactions} giao dịch trong ${body.latencyMs} ms.`, 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không truy vấn được API Cake', 'error');
    } finally { setBankTesting(false); }
  }

  async function saveRuntimeConfig(event: FormEvent) {
    event.preventDefault(); setBotBusy(true); setMessage('');
    try {
      const response = await authorized('/admin/bot-config/runtime', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() }, body: JSON.stringify({
          shopName: runtimeConfig.shopName.trim(), adminTelegramIds: runtimeConfig.adminTelegramIds.replace(/\s+/g, ''),
          apiUrl: runtimeConfig.apiUrl.trim(), telegramWebhookUrl: runtimeConfig.telegramWebhookUrl.trim(),
          qstashUrl: runtimeConfig.qstashUrl.trim(), taskBaseUrl: runtimeConfig.taskBaseUrl.trim(),
          qstashToken: qstashToken.trim(),
        }) });
      const body = (await readApiBody(response)) as { runtime?: RuntimeConfig; reloadWithinSeconds?: number; message?: string };
      if (!response.ok || !body.runtime) throw new Error(apiErrorMessage(body, 'Không thể lưu cấu hình runtime'));
      setRuntimeConfig(body.runtime); setQstashToken('');
      setBotConfig((current) => current ? { ...current, runtime: body.runtime } : { configured: false, runtime: body.runtime });
      setMessage(`Đã lưu cấu hình runtime vào MongoDB. Bot và queue nhận thay đổi trong tối đa ${body.reloadWithinSeconds ?? 15} giây.`, 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu cấu hình runtime', 'error');
    } finally { setBotBusy(false); }
  }

  const bankQrUrl = buildBankQrUrl({ bankId, accountNo: bankAccountNo, template: bankTemplate,
    accountName: bankAccountName, amount: bankAmount, description: bankDescription });
  const cakeCallbackUrl = runtimeConfig.apiUrl.trim()
    ? `${runtimeConfig.apiUrl.trim().replace(/\/+$/, '')}/api/webhooks/bank/cake` : '';

  if (!tokens) return <><FlashMessage message={flash} remainingMs={flashRemainingMs} close={() => setMessage('')} />
    <Login email={email} password={password} busy={busy} setEmail={setEmail} setPassword={setPassword} submit={login} /></>;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <FlashMessage message={flash} remainingMs={flashRemainingMs} close={() => setMessage('')} />
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <button type="button" onClick={() => navigate('dashboard')} className="flex min-w-0 items-center gap-3 text-left">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300"><LayoutDashboard size={21} /></span>
            <span className="min-w-0"><span className="block truncate font-semibold text-slate-50">Digital Store</span><span className="block truncate text-xs text-slate-500">Trung tâm quản trị</span></span>
          </button>
          <button onClick={logout} className="button-secondary inline-flex shrink-0 items-center gap-2 px-3 py-2"><LogOut size={16} /><span className="hidden sm:inline">Đăng xuất</span></button>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1500px] gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:py-7">
        <AdminSidebar section={section} navigate={navigate} />
        <div className="min-w-0">
        {(['dashboard', 'orders', 'deposits'] as AdminSection[]).includes(section) && <OperationsDashboard
          view={section === 'orders' ? 'orders' : section === 'deposits' ? 'deposits' : 'overview'}
          authorized={authorized} setMessage={setMessage}
          onOpenCatalog={() => navigate('products')} onOpenInventory={() => navigate('inventory')}
          onOpenOrders={() => navigate('orders')} onOpenDeposits={() => navigate('deposits')} />}

        {(['users', 'ledger', 'audit'] as AdminSection[]).includes(section) && <ManagementHub
          view={section as 'users' | 'ledger' | 'audit'} authorized={authorized} setMessage={setMessage} />}

        {section === 'reports' && <ComplaintManager authorized={authorized} setMessage={setMessage} />}
        {section === 'messages' && <MessageCenter authorized={authorized} setMessage={setMessage} />}

        {section === 'categories' && <section className="space-y-6">
          <PageHeading eyebrow="Hàng hóa" title="Quản lý danh mục" description="Tổ chức sản phẩm theo nhóm để khách tìm nhanh hơn trên Telegram." />
          <CategoryManager categories={categories} authorized={authorized} reload={loadCategories} setMessage={setMessage} />
        </section>}

        {section === 'products' && <section className="space-y-6">
          <PageHeading eyebrow="Hàng hóa" title="Quản lý sản phẩm" description="Tạo, chỉnh sửa, gán danh mục và kiểm soát trạng thái bán của từng sản phẩm." />
          <ProductManager products={products} categories={categories} pagination={pagination} authorized={authorized}
            reload={loadProducts} selectProduct={(id) => { setProductId(id); navigate('inventory'); }} setMessage={setMessage} onPageChange={setProductPage} />
        </section>}

        {section === 'inventory' && <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <PageHeading eyebrow="Kho hàng" title="Nhập tài khoản nhanh theo từng dòng" description="Chọn sản phẩm, dán dữ liệu theo pattern và xem trước trước khi lưu. Khi nhập thành công, bot tự thông báo hàng mới về." />
            <InventoryManager products={products} authorized={authorized} reloadProducts={loadProducts} onReveal={reveal} setMessage={setMessage} refreshKey={inventoryVersion} />
            <Panel icon={<FileUp />} title="Nhập kho hàng loạt" subtitle="Một dòng là một tài khoản. Dữ liệu được mã hóa trước khi lưu vào kho.">
              <label className="label">1. Chọn sản phẩm</label><select className="input" value={productId} onChange={(event) => setProductId(event.target.value)} required><option value="">Chọn sản phẩm cần nhập kho</option>{products.map((product) => <option key={product._id} value={product._id}>{product.name} — còn {product.availableStock} sản phẩm</option>)}</select>
              <div className="mt-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                <p className="text-sm font-medium text-indigo-100">2. Dán dữ liệu theo pattern</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Pattern: <code className="rounded bg-slate-950 px-1.5 py-0.5 text-indigo-200">{selectedProduct ? inventoryPatternFor(selectedProduct) : 'chọn sản phẩm trước'}</code>{selectedProduct && <> · Ví dụ: <code className="rounded bg-slate-950 px-1.5 py-0.5 text-indigo-200">{patternPlaceholder(inventoryPatternFor(selectedProduct))}</code></>}</p>
              </div>
              <label className="label mt-5">Dữ liệu nhập kho</label><textarea className="input min-h-72 font-mono text-xs leading-6" value={source} onChange={(event) => setSource(event.target.value)} placeholder={selectedProduct ? patternPlaceholder(inventoryPatternFor(selectedProduct)) : 'email@gmail.com----matkhau'} />
              <div className="mt-4 flex flex-col gap-3 sm:flex-row"><button disabled={busy || !source.trim()} onClick={() => importRows(false)} className="button-secondary flex-1">Xem trước, chưa lưu</button><button disabled={busy || !source.trim() || !productId} onClick={() => importRows(true)} className="button-primary flex-1">{busy ? 'Đang xử lý…' : 'Nhập kho & báo khách'}</button></div>
            </Panel>
            {report && <Panel icon={<Boxes />} title="Kết quả nhập kho" subtitle={report.batchId ? `Mã lô: ${report.batchId}` : 'Bản xem trước — chưa lưu dữ liệu'}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{[['Tổng dòng', report.totalRows], ['Hợp lệ', report.validRows], ['Lỗi', report.invalidRows], ['Trùng', report.duplicateRows], ['Đã nhập', report.importedRows ?? '—'], ['Ghi đè', report.overwrittenRows ?? '—']].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-950 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</div>
              {report.restockNotificationQueued && <p className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">Đã xếp hàng gửi thông báo “hàng đã về” cho khách qua bot.</p>}
              {!!report.preview?.length && <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-emerald-300">{JSON.stringify(report.preview, null, 2)}</pre>}
              {!!(report.errors ?? report.skipped)?.length && <pre className="mt-4 max-h-60 overflow-auto rounded-xl bg-rose-950/30 p-4 text-xs text-rose-300">{JSON.stringify(report.errors ?? report.skipped, null, 2)}</pre>}
            </Panel>}
          </div>
          <aside className="space-y-6">
            <Panel icon={<Eye />} title="Tra cứu một dòng kho" subtitle="Dùng ObjectId để xem dữ liệu nhạy cảm. Mỗi lượt xem đều được ghi nhận.">
              <label className="label">Inventory ObjectId</label><input className="input font-mono text-xs" value={itemId} onChange={(event) => setItemId(event.target.value)} placeholder="Dán ID dòng kho" />
              <button disabled={busy || !itemId.trim()} onClick={() => void reveal()} className="button-primary mt-4 w-full">Xem dữ liệu</button>
              {payload && <div className="mt-4 rounded-xl bg-slate-950 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Định dạng sản phẩm</p>
                <code className="mt-1 block break-all text-xs text-indigo-300">{payload.inventoryPattern}</code>
                <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Dữ liệu đầy đủ</p>
                <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs leading-6 text-amber-200">{payload.formatted}</pre>
              </div>}
            </Panel>
            <Panel icon={<Boxes />} title="Mẹo nhập nhanh" subtitle="Để nhập không bị lỗi">
              <ul className="space-y-3 text-sm leading-6 text-slate-400"><li>• Đặt pattern trong phần Sản phẩm, ví dụ <code>email----password</code>.</li><li>• Mỗi dòng phải đủ các cột theo pattern.</li><li>• Bấm “Xem trước” nếu chưa chắc định dạng.</li></ul>
            </Panel>
          </aside>
        </section>}

        {section === 'bot' && <section className="space-y-6">
          <PageHeading eyebrow="Kênh bán hàng" title="Bot Telegram" description="Kiểm tra trạng thái bot, đổi token và chỉnh lời chào /start mà không cần deploy lại." />
          <Panel icon={<Bot />} title="Bot Telegram" subtitle="Đổi token đã mã hóa; bot tự nạp lại cấu hình.">
            {botConfig && <div className="mb-4 rounded-xl bg-slate-950 p-3 text-xs text-slate-300">
              <div className="flex items-center justify-between"><span>Trạng thái</span><span className="text-emerald-400">{botConfig.configured ? 'Đã cấu hình' : 'Chưa cấu hình'}</span></div>
              {botConfig.botUsername && <div className="mt-2 flex items-center justify-between"><span>Bot</span><span>@{botConfig.botUsername}</span></div>}
              {botConfig.maskedToken && <div className="mt-2 flex items-center justify-between"><span>Token</span><code>{botConfig.maskedToken}</code></div>}
              {botConfig.source && <div className="mt-2 flex items-center justify-between"><span>Nguồn</span><span>{botConfig.source}</span></div>}
            </div>}
            <form onSubmit={saveWelcomeMessage} className="mb-5 border-b border-slate-800 pb-5">
              <label className="label">Lời chào khi dùng /start</label>
              <textarea className="input min-h-24" value={welcomeMessage} onChange={(event) => setWelcomeMessage(event.target.value)} placeholder="Chào mừng bạn đến với shop ahwuocdz!" maxLength={2000} required />
              <button type="submit" disabled={botBusy || !welcomeMessage.trim()} className="button-primary mt-3 w-full">Lưu lời chào</button>
            </form>
            <form onSubmit={saveBotToken}>
              <label className="label">Token mới từ @BotFather</label>
              <input className="input font-mono" type="password" autoComplete="off" value={botToken}
                onChange={(event) => setBotToken(event.target.value)} placeholder="123456789:AA..." required />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button type="button" disabled={botBusy} onClick={loadBotConfig} className="button-secondary flex items-center justify-center gap-2"><RefreshCw size={15} />Tải trạng thái</button>
                <button type="submit" disabled={botBusy || !botToken.trim()} className="button-primary">{botBusy ? 'Đang xử lý…' : 'Lưu token'}</button>
              </div>
            </form>
            <p className="mt-3 text-xs leading-5 text-slate-500">Token được kiểm tra với Telegram, mã hóa AES-256-GCM và không bao giờ hiển thị lại dưới dạng đầy đủ.</p>
          </Panel>
        </section>}

        {section === 'payments' && <section className="space-y-6">
          <PageHeading eyebrow="Thanh toán" title="Nạp tiền & VietQR" description="Quản lý tài khoản nhận tiền, Cake callback và xem trước mã QR của shop." />
          <Panel icon={<QrCode />} title="Nạp tiền & VietQR" subtitle="Nhập token API ngân hàng và thông tin tài khoản để tạo Quick Link QR.">
            <form onSubmit={saveBankConfig} className="space-y-4">
              <div><label className="label">TOKEN_API_BANK</label><input className="input font-mono" type="password" autoComplete="off" value={bankToken}
                onChange={(event) => setBankToken(event.target.value)} placeholder="Để trống nếu giữ token hiện tại" /></div>
              {cakeCallbackUrl && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-xs font-medium text-emerald-200">Webhook Callback Cake</p>
                <code className="mt-2 block break-all text-xs text-slate-300">{cakeCallbackUrl}</code>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">Cấu hình Method POST, Content-Type application/json và header <code>signature</code> bằng đúng TOKEN_API_BANK. Callback được chống cộng tiền trùng theo transactionID.</p>
              </div>}
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">Mã ngân hàng (BANK_ID)</label><select className="input" value={bankId} onChange={(event) => setBankId(event.target.value)} required><option value="">Chọn ngân hàng</option>{bankOptions.map((bank) => <option key={`${bank.code}-${bank.bin}`} value={bank.code}>{bank.shortName} ({bank.code} · {bank.bin})</option>)}{bankId && !bankOptions.some((bank) => bank.code === bankId) && <option value={bankId}>{bankId} (đã nhập)</option>}</select><p className="mt-1 text-[11px] text-slate-500">Danh sách lấy từ API VietQR; có thể dùng code hoặc BIN.</p></div>
                <div><label className="label">Số tài khoản</label><input className="input font-mono" value={bankAccountNo} onChange={(event) => setBankAccountNo(event.target.value)} placeholder="113366668888" required /></div>
                <div><label className="label">Mẫu QR</label><select className="input" value={bankTemplate} onChange={(event) => setBankTemplate(event.target.value)}><option value="compact2">compact2</option><option value="compact">compact</option><option value="qr_only">qr_only</option><option value="print">print</option><option value="loax">loax</option></select></div>
                <div><label className="label">Tên tài khoản</label><input className="input" value={bankAccountName} onChange={(event) => setBankAccountName(event.target.value)} placeholder="NGUYEN VAN A" required /></div>
                <div><label className="label">Số tiền mặc định</label><input className="input" type="number" min="0" step="1" value={bankAmount} onChange={(event) => setBankAmount(Number(event.target.value))} /></div>
                <div><label className="label">Nội dung mặc định</label><input className="input" value={bankDescription} onChange={(event) => setBankDescription(event.target.value)} placeholder="NAP TG123456" /></div>
              </div>
              {bankQrUrl && <div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><p className="text-xs text-slate-400">Quick Link hiện tại — mở Cake Bank hoặc ứng dụng ngân hàng để quét QR.</p><a className="mt-2 block break-all text-xs text-indigo-300 underline" href={bankQrUrl} target="_blank" rel="noreferrer">{bankQrUrl}</a></div>}
              <div className="grid gap-3 sm:grid-cols-2">
                <button type="submit" disabled={botBusy || bankTesting} className="button-primary w-full">{botBusy ? 'Đang lưu…' : 'Lưu cấu hình ngân hàng'}</button>
                <button type="button" disabled={botBusy || bankTesting} onClick={testBankQuery}
                  className="button-secondary flex w-full items-center justify-center gap-2">
                  <Activity size={16} />{bankTesting ? 'Đang query Cake…' : 'Test query API Cake'}
                </button>
              </div>
              <p className="text-[11px] leading-5 text-slate-500">Nút test dùng TOKEN_API_BANK đang lưu trên server, chỉ đọc tối đa 10 giao dịch mới nhất và không cộng tiền.</p>
              {bankQueryTest && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-emerald-200">API Cake hoạt động</span>
                  <span className="text-slate-400">{bankQueryTest.latencyMs} ms · {bankQueryTest.incomingTransactions}/{bankQueryTest.totalTransactions} giao dịch vào</span>
                </div>
                <code className="mt-2 block text-[11px] text-slate-500">{bankQueryTest.endpoint}</code>
                <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                  {bankQueryTest.transactions.length === 0
                    ? <p className="text-xs text-amber-200">API trả về thành công nhưng chưa có giao dịch.</p>
                    : bankQueryTest.transactions.map((transaction) => <div key={transaction.transactionID}
                      className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs">
                      <div className="flex flex-wrap justify-between gap-2"><code className="text-indigo-300">#{transaction.transactionID}</code>
                        <span className={transaction.type === 'IN' ? 'text-emerald-300' : 'text-amber-300'}>{transaction.type} · {transaction.amount.toLocaleString('vi-VN')} đ</span></div>
                      <p className="mt-1 break-words text-slate-300">{transaction.description}</p>
                      {transaction.transactionDate && <p className="mt-1 text-slate-500">{transaction.transactionDate}</p>}
                    </div>)}
                </div>
              </div>}
            </form>
          </Panel>
        </section>}

        {section === 'system' && <section className="space-y-6">
          <PageHeading eyebrow="Hạ tầng" title="Runtime & kết nối" description="Cấu hình endpoint Telegram, QStash và các địa chỉ serverless dùng trong production." />
          <Panel icon={<ServerCog />} title="Cấu hình runtime — không cần deploy lại" subtitle="Các endpoint và token QStash được lưu trong MongoDB; giá trị bí mật được mã hóa trước khi lưu.">
            <form onSubmit={saveRuntimeConfig} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div><label className="label">Tên shop</label><input className="input" value={runtimeConfig.shopName}
                  onChange={(event) => setRuntimeConfig((current) => ({ ...current, shopName: event.target.value }))} placeholder="Shop ahwuocdz" required /></div>
                <div><label className="label">Telegram ID admin</label><input className="input font-mono" value={runtimeConfig.adminTelegramIds}
                  onChange={(event) => setRuntimeConfig((current) => ({ ...current, adminTelegramIds: event.target.value }))} placeholder="123456789,987654321" /><p className="mt-1 text-[11px] text-slate-500">ID số, nhiều tài khoản ngăn cách bằng dấu phẩy.</p></div>
                <div><label className="label">API URL</label><input className="input font-mono text-xs" value={runtimeConfig.apiUrl}
                  onChange={(event) => setRuntimeConfig((current) => ({ ...current, apiUrl: event.target.value }))} placeholder="https://shop.vercel.app" required /></div>
                <div><label className="label">Telegram webhook URL</label><input className="input font-mono text-xs" value={runtimeConfig.telegramWebhookUrl}
                  onChange={(event) => setRuntimeConfig((current) => ({ ...current, telegramWebhookUrl: event.target.value }))} placeholder="https://shop.vercel.app/api/telegram/webhook" /></div>
                <div><label className="label">QStash URL</label><input className="input font-mono text-xs" value={runtimeConfig.qstashUrl}
                  onChange={(event) => setRuntimeConfig((current) => ({ ...current, qstashUrl: event.target.value }))} placeholder="https://qstash.upstash.io" /></div>
                <div><label className="label">Task base URL</label><input className="input font-mono text-xs" value={runtimeConfig.taskBaseUrl}
                  onChange={(event) => setRuntimeConfig((current) => ({ ...current, taskBaseUrl: event.target.value }))} placeholder="https://shop.vercel.app" /></div>
              </div>
              <div><label className="label">QSTASH_TOKEN</label><input className="input font-mono" type="password" autoComplete="off" value={qstashToken}
                onChange={(event) => setQstashToken(event.target.value)} placeholder={runtimeConfig.maskedQstashToken ? `Đang dùng ${runtimeConfig.maskedQstashToken} — để trống nếu giữ nguyên` : 'Dán token QStash'} />
                <p className="mt-1 text-[11px] text-slate-500">Token mới sẽ được mã hóa AES-256-GCM; API không bao giờ trả lại token đầy đủ.</p></div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-100">
                Vẫn cần khai báo một lần trong Vercel: <code>ENCRYPTION_KEY</code>, <code>MONGODB_URI</code>, <code>JWT_ACCESS_SECRET</code>, <code>JWT_REFRESH_SECRET</code>, <code>BOT_API_SECRET</code>, <code>TELEGRAM_WEBHOOK_SECRET</code>, <code>TASK_QUEUE_SECRET</code> và <code>CRON_SECRET</code>. Đây là khóa nền tảng nên không cho sửa từ web.
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button type="button" disabled={botBusy} onClick={loadBotConfig} className="button-secondary flex-1">Tải lại cấu hình</button>
                <button type="submit" disabled={botBusy || !runtimeConfig.shopName.trim() || !runtimeConfig.apiUrl.trim()} className="button-primary flex-1">{botBusy ? 'Đang áp dụng…' : 'Lưu & áp dụng realtime'}</button>
              </div>
            </form>
          </Panel>
        </section>}
        </div>
      </div>
    </main>
  );
}

function FlashMessage({ message, remainingMs, close }: {
  message: FlashMessageState | null; remainingMs: number; close(): void;
}) {
  if (!message) return null;
  const styles = {
    success: { icon: <CheckCircle2 size={20} />, border: 'border-emerald-400/40', background: 'bg-emerald-950/95',
      text: 'text-emerald-50', muted: 'text-emerald-200', progress: 'bg-emerald-400' },
    error: { icon: <TriangleAlert size={20} />, border: 'border-rose-400/45', background: 'bg-rose-950/95',
      text: 'text-rose-50', muted: 'text-rose-200', progress: 'bg-rose-400' },
    warning: { icon: <TriangleAlert size={20} />, border: 'border-amber-400/45', background: 'bg-amber-950/95',
      text: 'text-amber-50', muted: 'text-amber-200', progress: 'bg-amber-400' },
    info: { icon: <Info size={20} />, border: 'border-indigo-400/40', background: 'bg-slate-900/95',
      text: 'text-indigo-50', muted: 'text-indigo-200', progress: 'bg-indigo-400' },
  }[message.kind];
  const progress = Math.max(0, Math.min(100, (remainingMs / flashDurationMs) * 100));
  return <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex justify-center px-3 sm:top-5">
    <div role={message.kind === 'error' ? 'alert' : 'status'} aria-live="polite"
      className={`flash-message pointer-events-auto relative w-full max-w-xl animate-[flash-in_180ms_ease-out] overflow-hidden rounded-2xl border shadow-2xl shadow-black/40 backdrop-blur-xl ${styles.border} ${styles.background} ${styles.text}`}>
      <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
        <span className={`mt-0.5 shrink-0 ${styles.muted}`}>{styles.icon}</span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-5">{message.text}</p>
        <span className={`min-w-10 rounded-lg bg-black/20 px-2 py-1 text-center font-mono text-[11px] tabular-nums ${styles.muted}`}>{(remainingMs / 1_000).toFixed(1)}s</span>
        <button type="button" onClick={close} className={`rounded-lg p-1 transition hover:bg-white/10 ${styles.muted}`} aria-label="Đóng thông báo"><X size={17} /></button>
      </div>
      <div className="h-1 bg-black/20"><div className={`h-full transition-[width] duration-100 ease-linear ${styles.progress}`} style={{ width: `${progress}%` }} /></div>
    </div>
  </div>;
}

function flashMessageKind(message: string): FlashMessageKind {
  if (/^(?:đã|✅|thành công)|\bhoạt động\b/iu.test(message)) return 'success';
  if (/không thể|không hợp lệ|thất bại|\blỗi\b|\bfailed\b|\binvalid\b|access denied|session expired/iu.test(message)) return 'error';
  if (/^(?:hãy|chưa|phát hiện)|cảnh báo|\btrùng\b/iu.test(message)) return 'warning';
  return 'info';
}

function Login(props: { email: string; password: string; busy: boolean; setEmail(value: string): void; setPassword(value: string): void; submit(event: FormEvent): void }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100"><form onSubmit={props.submit} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
    <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400"><KeyRound /></div><h1 className="text-2xl font-semibold">Admin sign in</h1><p className="mt-2 text-sm text-slate-400">JWT access and rotating refresh tokens protect this console.</p>
    <label className="label mt-8">Email</label><input className="input" type="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} required />
    <label className="label mt-4">Password</label><input className="input" type="password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} required />
    <button disabled={props.busy} className="button-primary mt-6 w-full">{props.busy ? 'Signing in…' : 'Sign in'}</button>
  </form></main>;
}

function AdminSidebar({ section, navigate }: { section: AdminSection; navigate(next: AdminSection): void }) {
  const groups: Array<{ label: string; items: Array<{ id: AdminSection; label: string; icon: React.ReactNode }> }> = [
    { label: 'Vận hành', items: [
      { id: 'dashboard', label: 'Tổng quan', icon: <LayoutDashboard size={17} /> },
      { id: 'orders', label: 'Đơn hàng', icon: <ShoppingCart size={17} /> },
      { id: 'reports', label: 'Khiếu nại', icon: <MessageSquareWarning size={17} /> },
      { id: 'messages', label: 'Tin nhắn', icon: <MessagesSquare size={17} /> },
      { id: 'deposits', label: 'Lịch sử nạp', icon: <WalletCards size={17} /> },
      { id: 'users', label: 'Khách hàng', icon: <Users size={17} /> },
    ] },
    { label: 'Hàng hóa', items: [
      { id: 'categories', label: 'Danh mục', icon: <Tags size={17} /> },
      { id: 'products', label: 'Sản phẩm', icon: <Package size={17} /> },
      { id: 'inventory', label: 'Kho hàng', icon: <Boxes size={17} /> },
    ] },
    { label: 'Kiểm soát', items: [
      { id: 'ledger', label: 'Sổ cái ví', icon: <CircleDollarSign size={17} /> },
      { id: 'audit', label: 'Nhật ký & tracing', icon: <Activity size={17} /> },
    ] },
    { label: 'Cấu hình', items: [
      { id: 'bot', label: 'Bot Telegram', icon: <Bot size={17} /> },
      { id: 'payments', label: 'Thanh toán', icon: <QrCode size={17} /> },
      { id: 'system', label: 'Runtime & QStash', icon: <ServerCog size={17} /> },
    ] },
  ];
  const items = groups.flatMap((group) => group.items);
  return <aside className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-xl lg:sticky lg:top-24 lg:self-start">
    <label className="flex items-center gap-3 lg:hidden"><ListChecks size={18} className="shrink-0 text-indigo-300" /><span className="sr-only">Chọn chức năng quản trị</span><select value={section} onChange={(event) => navigate(event.target.value as AdminSection)} className="input h-11 flex-1 py-2">{items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <div className="hidden lg:block"><div className="mb-3 flex items-center gap-2 px-2 py-2 text-sm font-medium text-slate-200"><ListChecks size={17} className="text-indigo-300" />Chức năng quản trị</div>
    <nav className="space-y-4" aria-label="Điều hướng quản trị">
      {groups.map((group) => <div key={group.label}><p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{group.label}</p><div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">{group.items.map((item) => <button key={item.id} type="button" onClick={() => navigate(item.id)} className={`flex min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${section === item.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/50' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}><span className="shrink-0">{item.icon}</span><span className="truncate">{item.label}</span></button>)}</div></div>)}
    </nav>
    </div>
  </aside>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-sm font-medium text-indigo-300">{eyebrow}</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">{title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p></div>;
}

function Panel({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl"><div className="mb-5 flex gap-3 text-indigo-400">{icon}<div><h2 className="font-semibold text-slate-100">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</p></div></div>{children}</div>;
}

function normalizeBotToken(value: string) {
  let token = value.trim().replace(/^(?:export\s+)?(?:BOT_TOKEN|TELEGRAM_BOT_TOKEN)\s*=\s*/i, '').trim();
  const quote = token[0];
  if ((quote === '"' || quote === "'") && token.at(-1) === quote) token = token.slice(1, -1).trim();
  return token;
}

function buildBankQrUrl(config: { bankId: string; accountNo: string; template: string; amount: number; description: string; accountName: string }) {
  if (!config.bankId.trim() || !config.accountNo.trim() || !config.accountName.trim()) return '';
  return `https://img.vietqr.io/image/${encodeURIComponent(config.bankId.trim())}-${encodeURIComponent(config.accountNo.trim())}-${encodeURIComponent(config.template)}.png?amount=${Math.max(0, config.amount)}&addInfo=${encodeURIComponent(config.description.trim())}&accountName=${encodeURIComponent(config.accountName.trim())}`;
}

function inventoryPatternFor(product: ProductRecord) {
  return product.inventoryPattern?.trim() || [...product.fieldDefinitions]
    .sort((left, right) => left.sortOrder - right.sortOrder).map((field) => field.key).join('----');
}

function parsePatternRows(source: string, pattern: string) {
  const definition = readInventoryPattern(pattern);
  return source.split(/\r?\n/).map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => entry.line)
    .map(({ line, number }) => {
      try { return parseInventoryPatternLine(line, definition); }
      catch (error) { throw new Error(`Dòng ${number} không khớp pattern: ${error instanceof Error ? error.message : 'sai định dạng'}.`); }
    });
}

function patternPlaceholder(pattern: string) {
  return inventoryPatternExample(readInventoryPattern(pattern));
}

function readInventoryPattern(pattern: string) {
  try { return parseInventoryPatternTemplate(pattern); }
  catch (error) { throw new Error(`Pattern không hợp lệ: ${error instanceof Error ? error.message : 'sai định dạng'}.`); }
}

function apiErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object' || !('message' in body)) return fallback;
  const value = body.message;
  if (Array.isArray(value)) return value.filter((message): message is string => typeof message === 'string').join('. ') || fallback;
  return typeof value === 'string' ? value : fallback;
}

function adminSectionFromLocation(): AdminSection {
  if (typeof window === 'undefined') return 'dashboard';
  const value = new URL(window.location.href).searchParams.get('view');
  const sections: AdminSection[] = ['dashboard', 'orders', 'reports', 'messages', 'deposits', 'users', 'categories', 'products', 'inventory', 'ledger', 'audit', 'bot', 'payments', 'system'];
  return sections.includes(value as AdminSection) ? value as AdminSection : 'dashboard';
}

function runtimeWithPublicDefaults(config: RuntimeConfig): RuntimeConfig {
  if (typeof window === 'undefined') return config;
  const origin = window.location.origin.replace(/\/+$/, '');
  const productionOrigin = origin.startsWith('https://');
  return {
    ...config,
    apiUrl: productionOrigin && !config.apiUrl.startsWith('https://') ? origin : config.apiUrl || origin,
    telegramWebhookUrl: config.telegramWebhookUrl || `${origin}/api/telegram/webhook`,
    qstashUrl: config.qstashUrl || 'https://qstash.upstash.io',
    taskBaseUrl: config.taskBaseUrl || origin,
  };
}

async function readApiBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as unknown; }
  catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` }; }
}
