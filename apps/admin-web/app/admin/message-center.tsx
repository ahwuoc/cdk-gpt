'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Megaphone, MessageCircle, MessagesSquare, RefreshCw, Send, Users } from 'lucide-react';
import type { AuthorizedRequest } from './operations-dashboard';
import { requestId } from './request-id';

interface Customer { id: string; telegramId: string; username?: string | null; displayName?: string | null; }
interface MessageRecord {
  id: string; direction: 'USER_TO_ADMIN' | 'ADMIN_TO_USER'; audience: 'DIRECT' | 'BROADCAST'; body: string;
  status: string; errorCode?: string | null; createdAt: string; user?: Customer | null;
}
interface BroadcastRecord { id: string; body: string; status: string; createdAt: string; sentAt?: string | null;
  metadata?: { sent?: number; failed?: number; recipientsProcessed?: number } }
interface Page<T> { items: T[]; page: number; limit: number; total: number; totalPages: number; }

export function MessageCenter({ authorized, setMessage }: {
  authorized: AuthorizedRequest; setMessage(message: string): void;
}) {
  const [mode, setMode] = useState<'direct' | 'broadcast'>('direct');
  const [telegramId, setTelegramId] = useState(''); const [directBody, setDirectBody] = useState('');
  const [broadcastBody, setBroadcastBody] = useState(''); const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false); const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const query = new URLSearchParams({ page: '1', limit: '100' });
      if (telegramId.trim()) query.set('telegramId', telegramId.trim());
      const response = await authorized(`/admin/messages?${query}`);
      const body = await json<Page<MessageRecord>>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể tải hộp thư.'));
      setMessages(Array.isArray(body.items) ? body.items : []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tải hộp thư.'); }
    finally { if (!silent) setLoading(false); }
  }, [authorized, setMessage, telegramId]);

  const loadBroadcasts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await authorized('/admin/messages/broadcasts?page=1&limit=30');
      const body = await json<Page<BroadcastRecord>>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể tải lịch sử gửi toàn bộ.'));
      setBroadcasts(Array.isArray(body.items) ? body.items : []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tải lịch sử gửi toàn bộ.'); }
    finally { if (!silent) setLoading(false); }
  }, [authorized, setMessage]);

  useEffect(() => {
    const value = new URL(window.location.href).searchParams.get('telegramId')?.trim();
    const timer = value ? window.setTimeout(() => setTelegramId(value), 0) : undefined;
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadMessages(), 250); return () => window.clearTimeout(timer); }, [loadMessages]);
  useEffect(() => {
    if (mode !== 'broadcast') return;
    const timer = window.setTimeout(() => void loadBroadcasts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadBroadcasts, mode]);
  useEffect(() => {
    const timer = window.setInterval(() => void (mode === 'direct' ? loadMessages(true) : loadBroadcasts(true)), 10_000);
    return () => window.clearInterval(timer);
  }, [loadBroadcasts, loadMessages, mode]);

  async function sendDirect() {
    if (!/^-?\d{1,32}$/.test(telegramId.trim())) { setMessage('Hãy nhập Telegram ID dạng số.'); return; }
    if (!directBody.trim()) { setMessage('Hãy nhập nội dung tin nhắn.'); return; }
    setBusy(true);
    try {
      const response = await authorized('/admin/messages/direct', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify({ telegramId: telegramId.trim(), body: directBody.trim() }) });
      const body = await json<{ status?: string; message?: string | string[] }>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể gửi tin nhắn.'));
      setDirectBody(''); setMessage('Đã gửi tin nhắn riêng qua Telegram.'); await loadMessages();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể gửi tin nhắn.'); }
    finally { setBusy(false); }
  }

  async function sendBroadcast() {
    const body = broadcastBody.trim();
    if (!body) { setMessage('Hãy nhập nội dung thông báo.'); return; }
    if (!window.confirm('Gửi nội dung này đến TOÀN BỘ khách đang hoạt động?')) return;
    setBusy(true);
    try {
      const response = await authorized('/admin/messages/broadcast', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() }, body: JSON.stringify({ body }) });
      const result = await json<{ queued?: boolean; message?: string | string[] }>(response);
      if (!response.ok) throw new Error(errorMessage(result, 'Không thể xếp hàng thông báo.'));
      setBroadcastBody(''); setMessage('Đã xếp hàng gửi toàn bộ. QStash/BullMQ sẽ gửi lần lượt và chống gửi trùng.');
      await loadBroadcasts();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể gửi thông báo.'); }
    finally { setBusy(false); }
  }

  return <section className="space-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex gap-3"><span className="rounded-2xl bg-indigo-500/12 p-3 text-indigo-300"><MessagesSquare /></span><div>
        <p className="text-sm font-medium text-indigo-300">Chăm sóc khách hàng</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Hộp thư Telegram</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Nhắn riêng theo Telegram ID, xem phản hồi của khách hoặc gửi thông báo đến toàn bộ người dùng.</p>
      </div></div>
      <button type="button" onClick={() => void (mode === 'direct' ? loadMessages() : loadBroadcasts())} disabled={loading}
        className="button-secondary inline-flex items-center justify-center gap-2 px-3 py-2.5"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Làm mới</button>
    </div>
    <div className="flex w-fit rounded-xl border border-slate-800 bg-slate-900 p-1">
      <button className={`rounded-lg px-4 py-2 text-sm ${mode === 'direct' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`} onClick={() => setMode('direct')}><MessageCircle size={15} className="mr-2 inline" />Nhắn riêng</button>
      <button className={`rounded-lg px-4 py-2 text-sm ${mode === 'broadcast' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`} onClick={() => setMode('broadcast')}><Megaphone size={15} className="mr-2 inline" />Nhắn toàn bộ</button>
    </div>

    {mode === 'direct' ? <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <label className="label">Telegram ID người nhận</label>
        <input className="input font-mono" value={telegramId} onChange={(event) => setTelegramId(event.target.value.replace(/[^\d-]/g, ''))} placeholder="5379318618" />
        <label className="label mt-4">Nội dung</label>
        <textarea className="input min-h-40" value={directBody} onChange={(event) => setDirectBody(event.target.value)} maxLength={4_000} placeholder="Nhập nội dung hỗ trợ…" />
        <p className="mt-2 text-right text-xs text-slate-500">{directBody.length}/4.000</p>
        <button type="button" disabled={busy || !directBody.trim() || !telegramId.trim()} onClick={() => void sendDirect()}
          className="button-primary mt-3 flex w-full items-center justify-center gap-2"><Send size={16} />{busy ? 'Đang gửi…' : 'Gửi riêng'}</button>
        <p className="mt-3 text-xs leading-5 text-slate-500">Khách phải từng mở bot. Tin nhắn có nút “Trả lời shop” để tạo hội thoại hai chiều.</p>
      </div>
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold text-white">Lịch sử hội thoại</h3><p className="mt-1 text-xs text-slate-500">{telegramId ? `Telegram ${telegramId}` : 'Tất cả tin nhắn gần đây'}</p></div>{loading && <LoaderCircle className="animate-spin text-indigo-300" size={18} />}</div>
        <div className="max-h-[620px] space-y-3 overflow-auto rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          {messages.map((message) => <button type="button" key={message.id} onClick={() => message.user?.telegramId && setTelegramId(message.user.telegramId)}
            className={`block max-w-[88%] rounded-2xl p-3 text-left text-sm ${message.direction === 'ADMIN_TO_USER' ? 'ml-auto bg-indigo-600/80 text-white' : 'bg-slate-800 text-slate-100'}`}>
            {!telegramId && message.user && <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-300">{person(message.user)}</p>}
            <p className="whitespace-pre-wrap break-words leading-6">{message.body}</p>
            <p className="mt-1 text-[10px] opacity-60">{dateTime(message.createdAt)} · {statusLabel(message.status)}{message.audience === 'BROADCAST' ? ' · broadcast' : ''}</p>
          </button>)}
          {!loading && messages.length === 0 && <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-sm text-slate-500"><MessageCircle />Chưa có tin nhắn.</div>}
        </div>
      </div>
    </div> : <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="rounded-3xl border border-amber-500/20 bg-slate-900 p-5">
        <div className="flex items-center gap-2 text-amber-200"><Users size={18} /><h3 className="font-semibold">Gửi toàn bộ khách</h3></div>
        <textarea className="input mt-4 min-h-48" value={broadcastBody} onChange={(event) => setBroadcastBody(event.target.value)} maxLength={4_000} placeholder="Thông báo chương trình mới, bảo trì…" />
        <p className="mt-2 text-right text-xs text-slate-500">{broadcastBody.length}/4.000</p>
        <button type="button" disabled={busy || !broadcastBody.trim()} onClick={() => void sendBroadcast()}
          className="button-primary mt-3 flex w-full items-center justify-center gap-2"><Megaphone size={16} />{busy ? 'Đang xếp hàng…' : 'Gửi đến tất cả'}</button>
        <p className="mt-3 text-xs leading-5 text-slate-500">Hệ thống gửi theo từng lô, giới hạn tốc độ Telegram và chống gửi trùng khi QStash retry.</p>
      </div>
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5"><h3 className="font-semibold text-white">Lịch sử broadcast</h3>
        <div className="mt-4 space-y-3">{broadcasts.map((item) => <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex flex-wrap justify-between gap-2"><Status value={item.status} /><span className="text-xs text-slate-500">{dateTime(item.createdAt)}</span></div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{item.body}</p>
          <p className="mt-2 text-xs text-slate-500">Đã gửi: {item.metadata?.sent ?? 0} · Lỗi: {item.metadata?.failed ?? 0} · Đã xử lý: {item.metadata?.recipientsProcessed ?? 0}</p>
        </article>)}{!loading && broadcasts.length === 0 && <p className="py-20 text-center text-sm text-slate-500">Chưa có broadcast.</p>}</div>
      </div>
    </div>}
  </section>;
}

function Status({ value }: { value: string }) { return <span className={`rounded-full px-2 py-0.5 text-[11px] ${value === 'SENT' ? 'bg-emerald-500/15 text-emerald-300' : value === 'FAILED' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{statusLabel(value)}</span>; }
function statusLabel(value: string) { return ({ SENT: 'Đã gửi', FAILED: 'Gửi lỗi', PENDING: 'Đang chờ', SENDING: 'Đang gửi', RECEIVED: 'Khách gửi' } as Record<string, string>)[value] ?? value; }
function person(user: Customer) { return user.displayName || (user.username ? `@${user.username}` : '') || `Telegram ${user.telegramId}`; }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
async function json<T>(response: Response): Promise<T> { const text = await response.text(); if (!text) return {} as T; try { return JSON.parse(text) as T; } catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` } as T; } }
function errorMessage(body: unknown, fallback: string) { if (!body || typeof body !== 'object' || !('message' in body)) return fallback; const value = (body as { message?: unknown }).message; return typeof value === 'string' ? value : Array.isArray(value) ? value.join('. ') : fallback; }
