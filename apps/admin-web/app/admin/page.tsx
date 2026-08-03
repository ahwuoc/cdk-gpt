'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Bot, Boxes, Eye, FileUp, KeyRound, LogOut, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import { ProductManager, type ProductRecord } from './product-manager';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface Tokens { accessToken: string; refreshToken: string; }
interface ImportReport {
  batchId?: string; totalRows: number; validRows: number; invalidRows: number; duplicateRows: number;
  importedRows?: number; preview?: Array<{ line: number; maskedPreview: Record<string, unknown> }>;
  errors?: Array<{ line: number; reason: string }>; skipped?: Array<{ line: number; reason: string }>;
}
interface BotConfig {
  configured: boolean; source?: string; botId?: number; botUsername?: string; maskedToken?: string;
  encryptionKeyVersion?: number; updatedAt?: string; reloadWithinSeconds?: number;
}

export default function AdminPage() {
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [productId, setProductId] = useState(''); const [source, setSource] = useState('');
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null); const [busy, setBusy] = useState(false);
  const [itemId, setItemId] = useState(''); const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [botConfig, setBotConfig] = useState<BotConfig | null>(null); const [botToken, setBotToken] = useState('');
  const [botBusy, setBotBusy] = useState(false);
  const [message, setMessage] = useState('');

  const logout = useCallback(() => { setTokens(null); sessionStorage.removeItem('store-admin-tokens'); }, []);

  const authorized = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!tokens) throw new Error('Login required');
    let response = await fetch(`${apiBase}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${tokens.accessToken}` } });
    if (response.status === 401) {
      const refresh = await fetch(`${apiBase}/admin/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
      if (!refresh.ok) { logout(); throw new Error('Session expired'); }
      const next = await refresh.json() as Tokens; setTokens(next); sessionStorage.setItem('store-admin-tokens', JSON.stringify(next));
      response = await fetch(`${apiBase}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${next.accessToken}` } });
    }
    return response;
  }, [logout, tokens]);

  const loadProducts = useCallback(async (signal?: AbortSignal) => {
    const response = await authorized('/admin/products', { signal });
    const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Không thể tải sản phẩm');
    setProducts(body); setProductId((current) => body.some((product: ProductRecord) => product._id === current) ? current : body[0]?._id ?? '');
  }, [authorized]);

  useEffect(() => {
    const stored = sessionStorage.getItem('store-admin-tokens');
    if (stored) queueMicrotask(() => setTokens(JSON.parse(stored) as Tokens));
  }, []);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    const controller = new AbortController();
    queueMicrotask(() => void loadProducts(controller.signal)
      .catch((error) => { if (error instanceof Error && error.name !== 'AbortError') setMessage(error.message); }));
    return () => controller.abort();
  }, [loadProducts, tokens?.accessToken]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch(`${apiBase}/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Login failed');
      setTokens(body); sessionStorage.setItem('store-admin-tokens', JSON.stringify(body)); setPassword('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Login failed'); }
    finally { setBusy(false); }
  }

  function parseRows() {
    const trimmed = source.trim(); if (!trimmed) throw new Error('Paste at least one JSON object');
    if (trimmed.startsWith('[')) return JSON.parse(trimmed) as Record<string, unknown>[];
    return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  async function importRows(commit: boolean) {
    setBusy(true); setMessage('');
    try {
      const rows = parseRows();
      const response = await authorized(`/admin/inventory/import${commit ? '' : '/preview'}`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId, rows, sourceName: 'admin-web.jsonl' }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Import failed');
      setReport(body); setMessage(commit ? `Imported ${body.importedRows} items` : 'Preview generated; no data was written');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed'); }
    finally { setBusy(false); }
  }

  async function reveal() {
    setBusy(true); setPayload(null); setMessage('');
    try {
      const response = await authorized(`/admin/inventory/${itemId}/payload`, { headers: { 'x-request-id': crypto.randomUUID() } });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Access denied'); setPayload(body);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to read item'); }
    finally { setBusy(false); }
  }

  async function loadBotConfig() {
    setBotBusy(true); setMessage('');
    try {
      const response = await authorized('/admin/bot-config');
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Không thể tải cấu hình bot');
      setBotConfig(body);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tải cấu hình bot'); }
    finally { setBotBusy(false); }
  }

  async function saveBotToken(event: FormEvent) {
    event.preventDefault(); setBotBusy(true); setMessage('');
    try {
      const response = await authorized('/admin/bot-config/token', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-request-id': crypto.randomUUID() },
        body: JSON.stringify({ token: botToken.trim() }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Token Telegram không hợp lệ');
      setBotConfig(body); setBotToken('');
      setMessage(`Đã lưu token. Bot @${body.botUsername ?? body.botId} sẽ tự nạp lại trong tối đa ${body.reloadWithinSeconds} giây.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể cập nhật token'); }
    finally { setBotBusy(false); }
  }

  if (!tokens) return <Login email={email} password={password} busy={busy} message={message} setEmail={setEmail} setPassword={setPassword} submit={login} />;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3"><ShieldCheck className="text-indigo-400" /><div><h1 className="font-semibold">Digital Store Admin</h1><p className="text-xs text-slate-400">Encrypted inventory operations</p></div></div>
          <button onClick={logout} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"><LogOut size={16} />Sign out</button>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[1fr_360px]">
        <section className="space-y-6">
          <ProductManager products={products} authorized={authorized} reload={loadProducts} selectProduct={setProductId} setMessage={setMessage} />
          <Panel icon={<FileUp />} title="Bulk inventory import" subtitle="JSON array or one JSON object per line. Values are encrypted by the API before persistence.">
            <label className="label">Sản phẩm</label><select className="input" value={productId} onChange={(event) => setProductId(event.target.value)} required><option value="">Chọn sản phẩm</option>{products.map((product) => <option key={product._id} value={product._id}>{product.name} — tồn {product.availableStock}</option>)}</select>
            <label className="label mt-4">Rows</label><textarea className="input min-h-64 font-mono text-xs" value={source} onChange={(event) => setSource(event.target.value)} placeholder={'{"login":"user@example.com","password":"secret"}'} />
            <div className="mt-4 flex gap-3"><button disabled={busy} onClick={() => importRows(false)} className="button-secondary">Preview</button><button disabled={busy} onClick={() => importRows(true)} className="button-primary">Encrypt & import</button></div>
          </Panel>
          {report && <Panel icon={<Boxes />} title="Import report" subtitle={report.batchId ? `Batch ${report.batchId}` : 'Preview only'}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Total', report.totalRows], ['Valid', report.validRows], ['Invalid', report.invalidRows], ['Duplicates', report.duplicateRows], ['Imported', report.importedRows ?? '—']].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-950 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</div>
            {!!report.preview?.length && <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-emerald-300">{JSON.stringify(report.preview, null, 2)}</pre>}
            {!!(report.errors ?? report.skipped)?.length && <pre className="mt-4 max-h-60 overflow-auto rounded-xl bg-rose-950/30 p-4 text-xs text-rose-300">{JSON.stringify(report.errors ?? report.skipped, null, 2)}</pre>}
          </Panel>}
        </section>
        <aside className="space-y-6">
          <Panel icon={<Bot />} title="Telegram bot token" subtitle="Đổi token đã mã hóa mà không cần build hoặc restart container. Bot tự nạp lại cấu hình.">
            {botConfig && <div className="mb-4 rounded-xl bg-slate-950 p-3 text-xs text-slate-300">
              <div className="flex items-center justify-between"><span>Trạng thái</span><span className="text-emerald-400">{botConfig.configured ? 'Đã cấu hình' : 'Chưa cấu hình'}</span></div>
              {botConfig.botUsername && <div className="mt-2 flex items-center justify-between"><span>Bot</span><span>@{botConfig.botUsername}</span></div>}
              {botConfig.maskedToken && <div className="mt-2 flex items-center justify-between"><span>Token</span><code>{botConfig.maskedToken}</code></div>}
              {botConfig.source && <div className="mt-2 flex items-center justify-between"><span>Nguồn</span><span>{botConfig.source}</span></div>}
            </div>}
            <form onSubmit={saveBotToken}>
              <label className="label">Token mới từ @BotFather</label>
              <input className="input font-mono" type="password" autoComplete="off" value={botToken}
                onChange={(event) => setBotToken(event.target.value)} placeholder="123456789:AA..." required />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button type="button" disabled={botBusy} onClick={loadBotConfig} className="button-secondary flex items-center justify-center gap-2"><RefreshCw size={15} />Tải trạng thái</button>
                <button disabled={botBusy || !botToken.trim()} className="button-primary">Lưu token</button>
              </div>
            </form>
            <p className="mt-3 text-xs leading-5 text-slate-500">Token được kiểm tra với Telegram, mã hóa AES-256-GCM và không bao giờ hiển thị lại dưới dạng đầy đủ.</p>
          </Panel>
          <Panel icon={<Eye />} title="Sensitive item access" subtitle="Requires inventory.read_sensitive. Every reveal is audited.">
            <label className="label">Inventory ObjectId</label><input className="input" value={itemId} onChange={(event) => setItemId(event.target.value)} />
            <button disabled={busy} onClick={reveal} className="button-primary mt-4 w-full">Reveal payload</button>
            {payload && <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-amber-200">{JSON.stringify(payload, null, 2)}</pre>}
          </Panel>
          <Panel icon={<WalletCards />} title="Safety invariants" subtitle="Operational guarantees enforced by the API.">
            <ul className="space-y-2 text-sm text-slate-300"><li>• MongoDB replica-set transactions</li><li>• Integer wallet accounting ledger</li><li>• Atomic inventory reservation</li><li>• Idempotent delivery jobs</li><li>• No plaintext payload logs</li></ul>
          </Panel>
          {message && <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 text-sm text-indigo-200">{message}</div>}
        </aside>
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

function Panel({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl"><div className="mb-5 flex gap-3 text-indigo-400">{icon}<div><h2 className="font-semibold text-slate-100">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</p></div></div>{children}</div>;
}
