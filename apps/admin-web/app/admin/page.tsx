'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Boxes, Eye, FileUp, KeyRound, LayoutDashboard, LogOut, PackageOpen, QrCode, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import { CategoryManager } from './category-manager';
import { InventoryManager } from './inventory-manager';
import { OperationsDashboard } from './operations-dashboard';
import { ProductManager, type CategoryRecord, type ProductPagination, type ProductRecord } from './product-manager';
import { requestId } from './request-id';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface Tokens { accessToken: string; refreshToken?: string; }
interface ImportReport {
  batchId?: string; totalRows: number; validRows: number; invalidRows: number; duplicateRows: number;
  importedRows?: number; preview?: Array<{ line: number; maskedPreview: Record<string, unknown> }>;
  errors?: Array<{ line: number; reason: string }>; skipped?: Array<{ line: number; reason: string }>;
  restockNotificationQueued?: boolean;
}
interface BankConfig {
  configured: boolean; source?: string; maskedToken?: string; bankId: string; accountNo: string; template: string;
  accountName: string; amount: number; description: string; qrUrl?: string; updatedAt?: string;
}
interface BankOption { name: string; code: string; bin: string; shortName: string; }
interface RuntimeConfig {
  shopName: string; adminTelegramIds: string; apiUrl: string; telegramWebhookUrl: string;
  qstashUrl: string; taskBaseUrl: string; qstashConfigured?: boolean; qstashSource?: string;
  maskedQstashToken?: string; updatedAt?: string;
}
interface BotConfig {
  configured: boolean; source?: string; botId?: number; botUsername?: string; maskedToken?: string;
  encryptionKeyVersion?: number; updatedAt?: string; reloadWithinSeconds?: number; welcomeMessage?: string;
  bank?: BankConfig; runtime?: RuntimeConfig;
}
type AdminSection = 'dashboard' | 'catalog' | 'inventory' | 'configuration';

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
  const [itemId, setItemId] = useState(''); const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [botConfig, setBotConfig] = useState<BotConfig | null>(null); const [botToken, setBotToken] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [bankToken, setBankToken] = useState(''); const [bankId, setBankId] = useState('');
  const [bankAccountNo, setBankAccountNo] = useState(''); const [bankTemplate, setBankTemplate] = useState('compact2');
  const [bankAccountName, setBankAccountName] = useState(''); const [bankAmount, setBankAmount] = useState(0);
  const [bankDescription, setBankDescription] = useState(''); const [bankOptions, setBankOptions] = useState<BankOption[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({ shopName: 'Digital Store', adminTelegramIds: '',
    apiUrl: '', telegramWebhookUrl: '', qstashUrl: 'https://qstash-us-east-1.upstash.io', taskBaseUrl: '' });
  const [qstashToken, setQstashToken] = useState('');
  const [botBusy, setBotBusy] = useState(false);
  const [botMessage, setBotMessage] = useState(''); const [botMessageKind, setBotMessageKind] = useState<'error' | 'success'>('success');
  const [message, setMessage] = useState('');
  const [section, setSection] = useState<AdminSection>('dashboard');
  const selectedProduct = products.find((product) => product._id === productId);

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
    if (!tokens?.accessToken) return;
    const controller = new AbortController();
    queueMicrotask(() => void Promise.all([loadProducts(controller.signal), loadCategories(controller.signal)])
      .catch((error) => { if (error instanceof Error && error.name !== 'AbortError') setMessage(error.message); }));
    return () => controller.abort();
  }, [loadCategories, loadProducts, tokens?.accessToken]);

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
      const response = await authorized(`/admin/inventory/import${commit ? '' : '/preview'}`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId, rows, sourceName: 'admin-web.jsonl' }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Import failed');
      setReport(body); setMessage(commit
        ? `Đã nhập ${body.importedRows} hàng${body.restockNotificationQueued ? ' và đã xếp hàng thông báo “hàng đã về” cho khách.' : '.'}`
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
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Access denied'); setPayload(body);
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
    setBotBusy(true); setBotMessage('');
    try {
      const response = await authorized('/admin/bot-config');
      const body = (await readApiBody(response)) as BotConfig; if (!response.ok) throw new Error(apiErrorMessage(body, 'Không thể tải cấu hình bot'));
      setBotConfig(body);
      setWelcomeMessage(body.welcomeMessage ?? '');
      setBankToken(''); setBankId(body.bank?.bankId ?? ''); setBankAccountNo(body.bank?.accountNo ?? '');
      setBankTemplate(body.bank?.template ?? 'compact2'); setBankAccountName(body.bank?.accountName ?? '');
      setBankAmount(body.bank?.amount ?? 0); setBankDescription(body.bank?.description ?? '');
      if (body.runtime) setRuntimeConfig(body.runtime);
      setQstashToken('');
      await loadBankOptions();
      setBotMessageKind('success'); setBotMessage(body.configured ? 'Đã tải trạng thái bot.' : 'Chưa có token Telegram nào được lưu.');
    } catch (error) {
      setBotMessageKind('error'); setBotMessage(error instanceof Error ? error.message : 'Không thể tải cấu hình bot');
    }
    finally { setBotBusy(false); }
  }, [authorized, loadBankOptions]);

  useEffect(() => {
    if (tokens?.accessToken) queueMicrotask(() => void loadBotConfig());
  }, [loadBotConfig, tokens?.accessToken]);

  async function saveWelcomeMessage(event: FormEvent) {
    event.preventDefault(); setBotBusy(true); setBotMessage('');
    try {
      const message = welcomeMessage.trim();
      if (!message) throw new Error('Hãy nhập lời chào cho bot.');
      const response = await authorized('/admin/bot-config/welcome', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() }, body: JSON.stringify({ message }) });
      const body = (await readApiBody(response)) as Partial<BotConfig>; if (!response.ok) throw new Error(apiErrorMessage(body, 'Không thể lưu lời chào'));
      setBotConfig((current) => current ? { ...current, ...body, welcomeMessage: message } : { configured: false, ...body, welcomeMessage: message });
      setBotMessageKind('success'); setBotMessage(`Đã lưu lời chào. Bot sẽ nạp nội dung mới trong tối đa ${body.reloadWithinSeconds ?? 15} giây.`);
    } catch (error) {
      setBotMessageKind('error'); setBotMessage(error instanceof Error ? error.message : 'Không thể lưu lời chào');
    }
    finally { setBotBusy(false); }
  }

  async function saveBotToken(event: FormEvent) {
    event.preventDefault(); setBotBusy(true); setBotMessage('');
    try {
      const token = normalizeBotToken(botToken);
      if (!token) throw new Error('Hãy nhập token Telegram từ @BotFather.');
      const response = await authorized('/admin/bot-config/token', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify({ token }) });
      const body = (await readApiBody(response)) as BotConfig; if (!response.ok) throw new Error(apiErrorMessage(body, 'Token Telegram không hợp lệ'));
      setBotConfig((current) => current ? { ...current, ...body } : body); setBotToken('');
      setBotMessageKind('success');
      setBotMessage(`Đã lưu token. Bot @${body.botUsername ?? body.botId} sẽ tự nạp lại trong tối đa ${body.reloadWithinSeconds} giây.`);
    } catch (error) {
      setBotMessageKind('error'); setBotMessage(error instanceof Error ? error.message : 'Không thể cập nhật token');
    }
    finally { setBotBusy(false); }
  }

  async function saveBankConfig(event: FormEvent) {
    event.preventDefault(); setBotBusy(true); setBotMessage('');
    try {
      if (!bankId.trim() || !bankAccountNo.trim() || !bankAccountName.trim()) throw new Error('Hãy nhập đủ mã ngân hàng, số tài khoản và tên tài khoản.');
      const response = await authorized('/admin/bot-config/bank', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify({ tokenApiBank: bankToken.trim(), bankId: bankId.trim(), accountNo: bankAccountNo.trim(),
          template: bankTemplate, accountName: bankAccountName.trim(), amount: bankAmount, description: bankDescription.trim() }), });
      const body = (await readApiBody(response)) as { bank?: BankConfig; reloadWithinSeconds?: number; message?: string };
      if (!response.ok || !body.bank) throw new Error(apiErrorMessage(body, 'Không thể lưu cấu hình ngân hàng'));
      setBotConfig((current) => current ? { ...current, bank: body.bank } : { configured: false, bank: body.bank });
      setBankToken(''); setBotMessageKind('success'); setBotMessage(`Đã lưu cấu hình VietQR. Token ngân hàng được mã hóa và không hiển thị lại.`);
    } catch (error) {
      setBotMessageKind('error'); setBotMessage(error instanceof Error ? error.message : 'Không thể lưu cấu hình ngân hàng');
    }
    finally { setBotBusy(false); }
  }

  async function saveRuntimeConfig(event: FormEvent) {
    event.preventDefault(); setBotBusy(true); setBotMessage('');
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
      setBotMessageKind('success');
      setBotMessage(`Đã lưu cấu hình runtime vào MongoDB. Bot và queue nhận thay đổi trong tối đa ${body.reloadWithinSeconds ?? 15} giây.`);
    } catch (error) {
      setBotMessageKind('error'); setBotMessage(error instanceof Error ? error.message : 'Không thể lưu cấu hình runtime');
    } finally { setBotBusy(false); }
  }

  const bankQrUrl = buildBankQrUrl({ bankId, accountNo: bankAccountNo, template: bankTemplate,
    accountName: bankAccountName, amount: bankAmount, description: bankDescription });

  if (!tokens) return <Login email={email} password={password} busy={busy} message={message} setEmail={setEmail} setPassword={setPassword} submit={login} />;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <button type="button" onClick={() => setSection('dashboard')} className="flex min-w-0 items-center gap-3 text-left">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300"><ShieldCheck size={21} /></span>
            <span className="min-w-0"><span className="block truncate font-semibold text-slate-50">Digital Store</span><span className="block truncate text-xs text-slate-500">Quản trị shop & bot Telegram</span></span>
          </button>
          <button onClick={logout} className="button-secondary inline-flex shrink-0 items-center gap-2 px-3 py-2"><LogOut size={16} /><span className="hidden sm:inline">Đăng xuất</span></button>
        </div>
        <div className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6">
          <nav className="flex min-w-max gap-1 pb-3" aria-label="Điều hướng quản trị">
            <AdminNav active={section === 'dashboard'} onClick={() => setSection('dashboard')} icon={<LayoutDashboard size={16} />}>Tổng quan</AdminNav>
            <AdminNav active={section === 'catalog'} onClick={() => setSection('catalog')} icon={<PackageOpen size={16} />}>Sản phẩm</AdminNav>
            <AdminNav active={section === 'inventory'} onClick={() => setSection('inventory')} icon={<Boxes size={16} />}>Kho hàng</AdminNav>
            <AdminNav active={section === 'configuration'} onClick={() => setSection('configuration')} icon={<Settings2 size={16} />}>Bot & thanh toán</AdminNav>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {message && <div role="status" className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4 text-sm text-indigo-100"><span>{message}</span><button type="button" onClick={() => setMessage('')} className="text-indigo-200 hover:text-white" aria-label="Đóng thông báo">×</button></div>}

        {section === 'dashboard' && <OperationsDashboard authorized={authorized} setMessage={setMessage} onOpenCatalog={() => setSection('catalog')} onOpenInventory={() => setSection('inventory')} />}

        {section === 'catalog' && <section className="space-y-6">
          <PageHeading eyebrow="Danh mục & sản phẩm" title="Tạo sản phẩm, gán danh mục và quản lý tồn kho" description="Đi từ trên xuống: tạo danh mục → tạo sản phẩm → qua mục Kho hàng để nhập tài khoản." />
          <CategoryManager categories={categories} authorized={authorized} reload={loadCategories} setMessage={setMessage} />
          <ProductManager products={products} categories={categories} pagination={pagination} authorized={authorized}
            reload={loadProducts} selectProduct={(id) => { setProductId(id); setSection('inventory'); }} setMessage={setMessage} onPageChange={setProductPage} />
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Tổng dòng', report.totalRows], ['Hợp lệ', report.validRows], ['Lỗi', report.invalidRows], ['Trùng', report.duplicateRows], ['Đã nhập', report.importedRows ?? '—']].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-950 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</div>
              {report.restockNotificationQueued && <p className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">Đã xếp hàng gửi thông báo “hàng đã về” cho khách qua bot.</p>}
              {!!report.preview?.length && <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-emerald-300">{JSON.stringify(report.preview, null, 2)}</pre>}
              {!!(report.errors ?? report.skipped)?.length && <pre className="mt-4 max-h-60 overflow-auto rounded-xl bg-rose-950/30 p-4 text-xs text-rose-300">{JSON.stringify(report.errors ?? report.skipped, null, 2)}</pre>}
            </Panel>}
          </div>
          <aside className="space-y-6">
            <Panel icon={<Eye />} title="Tra cứu một dòng kho" subtitle="Dùng ObjectId để xem dữ liệu nhạy cảm. Mỗi lượt xem đều được ghi nhận.">
              <label className="label">Inventory ObjectId</label><input className="input font-mono text-xs" value={itemId} onChange={(event) => setItemId(event.target.value)} placeholder="Dán ID dòng kho" />
              <button disabled={busy || !itemId.trim()} onClick={() => void reveal()} className="button-primary mt-4 w-full">Xem dữ liệu</button>
              {payload && <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-amber-200">{JSON.stringify(payload, null, 2)}</pre>}
            </Panel>
            <Panel icon={<Boxes />} title="Mẹo nhập nhanh" subtitle="Để nhập không bị lỗi">
              <ul className="space-y-3 text-sm leading-6 text-slate-400"><li>• Đặt pattern trong phần Sản phẩm, ví dụ <code>email----password</code>.</li><li>• Mỗi dòng phải đủ các cột theo pattern.</li><li>• Bấm “Xem trước” nếu chưa chắc định dạng.</li></ul>
            </Panel>
          </aside>
        </section>}

        {section === 'configuration' && <section className="space-y-6">
          <PageHeading eyebrow="Cấu hình" title="Bot Telegram và nhận tiền" description="Lưu token, chỉnh lời chào /start và tạo QR nạp tiền ngay trên web — không cần build lại ứng dụng." />
          <div className="grid gap-6 xl:grid-cols-2">
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
            {botMessage && <div role="status" className={`mt-4 rounded-xl border p-3 text-sm ${botMessageKind === 'error' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>{botMessage}</div>}
            <p className="mt-3 text-xs leading-5 text-slate-500">Token được kiểm tra với Telegram, mã hóa AES-256-GCM và không bao giờ hiển thị lại dưới dạng đầy đủ.</p>
          </Panel>
          <Panel icon={<QrCode />} title="Nạp tiền & VietQR" subtitle="Nhập token API ngân hàng và thông tin tài khoản để tạo Quick Link QR.">
            <form onSubmit={saveBankConfig} className="space-y-4">
              <div><label className="label">TOKEN_API_BANK</label><input className="input font-mono" type="password" autoComplete="off" value={bankToken}
                onChange={(event) => setBankToken(event.target.value)} placeholder="Để trống nếu giữ token hiện tại" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">Mã ngân hàng (BANK_ID)</label><select className="input" value={bankId} onChange={(event) => setBankId(event.target.value)} required><option value="">Chọn ngân hàng</option>{bankOptions.map((bank) => <option key={`${bank.code}-${bank.bin}`} value={bank.code}>{bank.shortName} ({bank.code} · {bank.bin})</option>)}{bankId && !bankOptions.some((bank) => bank.code === bankId) && <option value={bankId}>{bankId} (đã nhập)</option>}</select><p className="mt-1 text-[11px] text-slate-500">Danh sách lấy từ API VietQR; có thể dùng code hoặc BIN.</p></div>
                <div><label className="label">Số tài khoản</label><input className="input font-mono" value={bankAccountNo} onChange={(event) => setBankAccountNo(event.target.value)} placeholder="113366668888" required /></div>
                <div><label className="label">Mẫu QR</label><select className="input" value={bankTemplate} onChange={(event) => setBankTemplate(event.target.value)}><option value="compact2">compact2</option><option value="compact">compact</option><option value="qr_only">qr_only</option><option value="print">print</option><option value="loax">loax</option></select></div>
                <div><label className="label">Tên tài khoản</label><input className="input" value={bankAccountName} onChange={(event) => setBankAccountName(event.target.value)} placeholder="NGUYEN VAN A" required /></div>
                <div><label className="label">Số tiền mặc định</label><input className="input" type="number" min="0" step="1" value={bankAmount} onChange={(event) => setBankAmount(Number(event.target.value))} /></div>
                <div><label className="label">Nội dung mặc định</label><input className="input" value={bankDescription} onChange={(event) => setBankDescription(event.target.value)} placeholder="NAP TG123456" /></div>
              </div>
              {bankQrUrl && <div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><p className="text-xs text-slate-400">Quick Link hiện tại — mở Cake Bank hoặc ứng dụng ngân hàng để quét QR.</p><a className="mt-2 block break-all text-xs text-indigo-300 underline" href={bankQrUrl} target="_blank" rel="noreferrer">{bankQrUrl}</a></div>}
              <button type="submit" disabled={botBusy} className="button-primary w-full">{botBusy ? 'Đang lưu…' : 'Lưu cấu hình ngân hàng'}</button>
            </form>
          </Panel>
          </div>
          <Panel icon={<Settings2 />} title="Cấu hình runtime — không cần deploy lại" subtitle="Các endpoint và token QStash được lưu trong MongoDB; giá trị bí mật được mã hóa trước khi lưu.">
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
                  onChange={(event) => setRuntimeConfig((current) => ({ ...current, qstashUrl: event.target.value }))} placeholder="https://qstash-us-east-1.upstash.io" /></div>
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
    </main>
  );
}

function Login(props: { email: string; password: string; busy: boolean; message: string; setEmail(value: string): void; setPassword(value: string): void; submit(event: FormEvent): void }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100"><form onSubmit={props.submit} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
    <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400"><KeyRound /></div><h1 className="text-2xl font-semibold">Admin sign in</h1><p className="mt-2 text-sm text-slate-400">JWT access and rotating refresh tokens protect this console.</p>
    <label className="label mt-8">Email</label><input className="input" type="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} required />
    <label className="label mt-4">Password</label><input className="input" type="password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} required />
    {props.message && <p className="mt-4 text-sm text-rose-400">{props.message}</p>}<button disabled={props.busy} className="button-primary mt-6 w-full">{props.busy ? 'Signing in…' : 'Sign in'}</button>
  </form></main>;
}

function AdminNav({ active, icon, children, onClick }: { active: boolean; icon: React.ReactNode; children: React.ReactNode; onClick(): void }) {
  return <button type="button" onClick={onClick} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/50' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}>{icon}{children}</button>;
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
  const { keys, separator } = parseInventoryPattern(pattern);
  return source.split(/\r?\n/).map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => entry.line)
    .map(({ line, number }) => {
      const values = separator ? splitPatternLine(line, separator, keys.length, number) : [line];
      return Object.fromEntries(keys.map((key, index) => [key, values[index] ?? '']));
    });
}

function parseInventoryPattern(pattern: string) {
  const parts = pattern.trim().split(/([^A-Za-z0-9_]+)/);
  const keys = parts.filter((_, index) => index % 2 === 0);
  const separators = parts.filter((_, index) => index % 2 === 1);
  if (!keys.length || keys.some((key) => !/^[a-z][a-zA-Z0-9_]{1,63}$/.test(key))) {
    throw new Error('Pattern không hợp lệ. Ví dụ đúng: email----password');
  }
  if (separators.length && (separators.some((separator) => /\s/.test(separator)) || !separators.every((separator) => separator === separators[0]))) {
    throw new Error('Pattern chỉ dùng một dấu ngăn cách không có khoảng trắng, ví dụ email----password');
  }
  return { keys, separator: separators[0] };
}

function splitPatternLine(line: string, separator: string, count: number, number: number) {
  const values: string[] = []; let remaining = line;
  for (let index = 0; index < count - 1; index++) {
    const position = remaining.indexOf(separator);
    if (position < 0) throw new Error(`Dòng ${number} thiếu dấu ngăn cách “${separator}”.`);
    values.push(remaining.slice(0, position));
    remaining = remaining.slice(position + separator.length);
  }
  values.push(remaining);
  return values;
}

function patternPlaceholder(pattern: string) {
  const { keys, separator } = parseInventoryPattern(pattern);
  return keys.map((key) => key === 'email' ? 'email@gmail.com' : key === 'password' ? 'matkhau' : key).join(separator ?? '');
}

function apiErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object' || !('message' in body)) return fallback;
  const value = body.message;
  if (Array.isArray(value)) return value.filter((message): message is string => typeof message === 'string').join('. ') || fallback;
  return typeof value === 'string' ? value : fallback;
}

async function readApiBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as unknown; }
  catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` }; }
}
