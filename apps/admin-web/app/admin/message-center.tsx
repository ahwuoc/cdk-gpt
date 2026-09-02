'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LoaderCircle, Megaphone, MessageCircle, MessagesSquare, Plus, RefreshCw, Search, Send, Users,
} from 'lucide-react';
import type { AuthorizedRequest } from './operations-dashboard';
import { requestId } from './request-id';

interface Customer { id: string; telegramId: string; username?: string | null; displayName?: string | null; }
interface MessageRecord {
  id: string; direction: 'USER_TO_ADMIN' | 'ADMIN_TO_USER'; audience: 'DIRECT' | 'BROADCAST'; body: string;
  status: string; errorCode?: string | null; createdAt: string; user?: Customer | null;
}
interface ConversationRecord { user: Customer; lastMessage: MessageRecord; messageCount: number; }
interface BroadcastRecord { id: string; body: string; status: string; createdAt: string; sentAt?: string | null;
  metadata?: { sent?: number; failed?: number; recipientsProcessed?: number } }
interface Page<T> { items: T[]; page: number; limit: number; total: number; totalPages: number; }

export function MessageCenter({ authorized, setMessage }: {
  authorized: AuthorizedRequest; setMessage(message: string): void;
}) {
  const [mode, setMode] = useState<'direct' | 'broadcast'>('direct');
  const [telegramId, setTelegramId] = useState('');
  const [manualTelegramId, setManualTelegramId] = useState('');
  const [conversationSearch, setConversationSearch] = useState('');
  const [directBody, setDirectBody] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [selectionReady, setSelectionReady] = useState(false);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async (silent = false) => {
    if (!silent) setConversationLoading(true);
    try {
      const query = new URLSearchParams({ page: '1', limit: '100' });
      if (conversationSearch.trim()) query.set('search', conversationSearch.trim());
      const response = await authorized(`/admin/messages/conversations?${query}`);
      const body = await json<Page<ConversationRecord>>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể tải danh sách hội thoại.'));
      setConversations(Array.isArray(body.items) ? body.items : []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tải danh sách hội thoại.'); }
    finally { if (!silent) setConversationLoading(false); }
  }, [authorized, conversationSearch, setMessage]);

  const loadMessages = useCallback(async (silent = false) => {
    const selectedId = telegramId.trim();
    if (!selectedId) { setMessages([]); return; }
    if (!silent) setMessageLoading(true);
    try {
      const query = new URLSearchParams({ page: '1', limit: '100', telegramId: selectedId });
      const response = await authorized(`/admin/messages?${query}`);
      const body = await json<Page<MessageRecord>>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể tải hội thoại.'));
      setMessages(Array.isArray(body.items) ? body.items : []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tải hội thoại.'); }
    finally { if (!silent) setMessageLoading(false); }
  }, [authorized, setMessage, telegramId]);

  const loadBroadcasts = useCallback(async (silent = false) => {
    if (!silent) setBroadcastLoading(true);
    try {
      const response = await authorized('/admin/messages/broadcasts?page=1&limit=30');
      const body = await json<Page<BroadcastRecord>>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể tải lịch sử gửi toàn bộ.'));
      setBroadcasts(Array.isArray(body.items) ? body.items : []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tải lịch sử gửi toàn bộ.'); }
    finally { if (!silent) setBroadcastLoading(false); }
  }, [authorized, setMessage]);

  const selectConversation = useCallback((id: string) => {
    setTelegramId(id);
    setManualTelegramId('');
    const url = new URL(window.location.href);
    url.searchParams.set('telegramId', id);
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    const value = new URL(window.location.href).searchParams.get('telegramId')?.trim() ?? '';
    const timer = window.setTimeout(() => { if (/^-?\d{1,32}$/.test(value)) setTelegramId(value); setSelectionReady(true); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(), 250);
    return () => window.clearTimeout(timer);
  }, [loadConversations]);
  useEffect(() => {
    if (!selectionReady || telegramId || conversations.length === 0) return;
    const timer = window.setTimeout(() => selectConversation(conversations[0].user.telegramId), 0);
    return () => window.clearTimeout(timer);
  }, [conversations, selectConversation, selectionReady, telegramId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadMessages(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages]);
  useEffect(() => {
    if (mode !== 'broadcast') return;
    const timer = window.setTimeout(() => void loadBroadcasts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadBroadcasts, mode]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (mode === 'direct') { void loadConversations(true); void loadMessages(true); }
      else void loadBroadcasts(true);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [loadBroadcasts, loadConversations, loadMessages, mode]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  async function sendDirect() {
    if (!/^-?\d{1,32}$/.test(telegramId.trim())) { setMessage('Hãy chọn khách hoặc nhập Telegram ID dạng số.'); return; }
    if (!directBody.trim()) { setMessage('Hãy nhập nội dung tin nhắn.'); return; }
    setBusy(true);
    try {
      const response = await authorized('/admin/messages/direct', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify({ telegramId: telegramId.trim(), body: directBody.trim() }) });
      const body = await json<{ status?: string; message?: string | string[] }>(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Không thể gửi tin nhắn.'));
      setDirectBody(''); setMessage('Đã gửi tin nhắn riêng qua Telegram.');
      await Promise.all([loadMessages(true), loadConversations(true)]);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể gửi tin nhắn.'); }
    finally { setBusy(false); }
  }

  function openManualConversation() {
    const id = manualTelegramId.trim();
    if (!/^-?\d{1,32}$/.test(id)) { setMessage('Telegram ID phải là số.'); return; }
    selectConversation(id);
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

  const selectedConversation = conversations.find((item) => item.user.telegramId === telegramId);
  const selectedUser = selectedConversation?.user ?? messages.find((item) => item.user)?.user ?? null;
  const refreshing = mode === 'direct' ? conversationLoading || messageLoading : broadcastLoading;

  return <section className="space-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex gap-3"><span className="rounded-2xl bg-indigo-500/12 p-3 text-indigo-300"><MessagesSquare /></span><div>
        <p className="text-sm font-medium text-indigo-300">Chăm sóc khách hàng</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Hộp thư Telegram</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Hội thoại mới nhất luôn ở trên. Chọn một khách bên trái để xem và trả lời ngay.</p>
      </div></div>
      <button type="button" onClick={() => void (mode === 'direct'
        ? Promise.all([loadConversations(), loadMessages()]) : loadBroadcasts())} disabled={refreshing}
        className="button-secondary inline-flex items-center justify-center gap-2 px-3 py-2.5"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />Làm mới</button>
    </div>
    <div className="flex w-fit rounded-xl border border-slate-800 bg-slate-900 p-1">
      <button className={`rounded-lg px-4 py-2 text-sm ${mode === 'direct' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`} onClick={() => setMode('direct')}><MessageCircle size={15} className="mr-2 inline" />Hội thoại</button>
      <button className={`rounded-lg px-4 py-2 text-sm ${mode === 'broadcast' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`} onClick={() => setMode('broadcast')}><Megaphone size={15} className="mr-2 inline" />Nhắn toàn bộ</button>
    </div>

    {mode === 'direct' ? <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 xl:grid xl:h-[min(720px,calc(100vh-250px))] xl:min-h-[600px] xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="flex min-h-[480px] flex-col border-b border-slate-800 xl:min-h-0 xl:border-b-0 xl:border-r">
        <div className="border-b border-slate-800 p-4">
          <h3 className="font-semibold text-white">Đoạn chat</h3>
          <div className="relative mt-3"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input className="input pl-9" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Tìm tên, @username, ID…" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.map((conversation) => {
            const active = conversation.user.telegramId === telegramId;
            return <button type="button" key={conversation.user.id} onClick={() => selectConversation(conversation.user.telegramId)}
              className={`flex w-full gap-3 border-b border-slate-800/80 px-4 py-3 text-left transition ${active ? 'bg-indigo-500/15' : 'hover:bg-slate-800/70'}`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${active ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}>{initials(conversation.user)}</span>
              <span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-100">{person(conversation.user)}</span>
                <span className="shrink-0 text-[10px] text-slate-500">{shortTime(conversation.lastMessage.createdAt)}</span>
              </span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500">ID {conversation.user.telegramId}</span>
              <span className={`mt-1 block truncate text-xs ${conversation.lastMessage.direction === 'USER_TO_ADMIN' ? 'font-medium text-slate-200' : 'text-slate-500'}`}>
                {conversation.lastMessage.direction === 'ADMIN_TO_USER' ? 'Bạn: ' : ''}{conversation.lastMessage.body}
              </span></span>
            </button>;
          })}
          {conversationLoading && conversations.length === 0 && <div className="flex h-40 items-center justify-center"><LoaderCircle className="animate-spin text-indigo-300" /></div>}
          {!conversationLoading && conversations.length === 0 && <div className="flex h-40 flex-col items-center justify-center gap-2 px-5 text-center text-sm text-slate-500"><MessageCircle size={22} />Chưa có hội thoại phù hợp.</div>}
        </div>
        <div className="border-t border-slate-800 p-3">
          <p className="mb-2 text-[11px] text-slate-500">Mở cuộc trò chuyện bằng Telegram ID</p>
          <div className="flex gap-2"><input className="input min-w-0 flex-1 font-mono text-sm" value={manualTelegramId}
            onChange={(event) => setManualTelegramId(event.target.value.replace(/[^\d-]/g, ''))}
            onKeyDown={(event) => { if (event.key === 'Enter') openManualConversation(); }} placeholder="5379318618" />
            <button type="button" onClick={openManualConversation} className="button-secondary flex shrink-0 items-center gap-1 px-3"><Plus size={15} />Mở</button></div>
        </div>
      </aside>

      <div className="flex min-h-[620px] flex-col xl:min-h-0">
        {telegramId ? <>
          <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
            <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">{selectedUser ? initials(selectedUser) : 'TG'}</span>
              <div className="min-w-0"><h3 className="truncate font-semibold text-white">{selectedUser ? person(selectedUser) : `Telegram ${telegramId}`}</h3>
                <p className="truncate font-mono text-xs text-slate-500">Telegram ID {telegramId}{selectedUser?.username ? ` · @${selectedUser.username}` : ''}</p></div>
            </div>
            {messageLoading && <LoaderCircle className="shrink-0 animate-spin text-indigo-300" size={18} />}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-950/35 px-4 py-5 sm:px-6">
            <div className="mx-auto flex max-w-4xl flex-col gap-2.5">
              {messages.map((message) => <div key={message.id}
                className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${message.direction === 'ADMIN_TO_USER'
                  ? 'ml-auto rounded-br-md bg-indigo-600 text-white' : 'mr-auto rounded-bl-md bg-slate-800 text-slate-100'}`}>
                <p className="whitespace-pre-wrap break-words leading-6">{message.body}</p>
                <p className={`mt-1 text-[10px] ${message.direction === 'ADMIN_TO_USER' ? 'text-indigo-100/70' : 'text-slate-500'}`}>
                  {dateTime(message.createdAt)} · {statusLabel(message.status)}
                </p>
              </div>)}
              {!messageLoading && messages.length === 0 && <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-sm text-slate-500"><MessageCircle size={28} /><span>Chưa có tin nhắn với Telegram ID này.<br />Soạn tin bên dưới để bắt đầu.</span></div>}
              <div ref={chatEndRef} />
            </div>
          </div>
          <div className="border-t border-slate-800 bg-slate-900 p-3 sm:p-4">
            <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border border-slate-700 bg-slate-950 p-2 focus-within:border-indigo-500">
              <textarea className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                rows={1} value={directBody} onChange={(event) => setDirectBody(event.target.value)} maxLength={4_000}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!busy && directBody.trim()) void sendDirect(); } }}
                placeholder="Nhập tin nhắn… (Enter để gửi, Shift+Enter xuống dòng)" />
              <button type="button" aria-label="Gửi tin nhắn" disabled={busy || !directBody.trim()} onClick={() => void sendDirect()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? <LoaderCircle className="animate-spin" size={18} /> : <Send size={18} />}
              </button>
            </div>
            <p className="mx-auto mt-2 max-w-4xl text-right text-[10px] text-slate-600">{directBody.length}/4.000 · Khách phải từng mở bot để nhận tin.</p>
          </div>
        </> : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-slate-500"><MessagesSquare size={40} /><h3 className="text-base font-medium text-slate-300">Chọn một cuộc trò chuyện</h3><p className="max-w-sm text-sm">Chọn khách trong danh sách bên trái để xem lịch sử và trả lời.</p></div>}
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
        </article>)}{!broadcastLoading && broadcasts.length === 0 && <p className="py-20 text-center text-sm text-slate-500">Chưa có broadcast.</p>}</div>
      </div>
    </div>}
  </section>;
}

function Status({ value }: { value: string }) { return <span className={`rounded-full px-2 py-0.5 text-[11px] ${value === 'SENT' ? 'bg-emerald-500/15 text-emerald-300' : value === 'FAILED' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{statusLabel(value)}</span>; }
function statusLabel(value: string) { return ({ SENT: 'Đã gửi', FAILED: 'Gửi lỗi', PENDING: 'Đang chờ', SENDING: 'Đang gửi', RECEIVED: 'Khách gửi' } as Record<string, string>)[value] ?? value; }
function person(user: Customer) { return user.displayName || (user.username ? `@${user.username}` : '') || `Telegram ${user.telegramId}`; }
function initials(user: Customer) {
  const value = user.displayName || user.username || user.telegramId;
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'TG';
}
function shortTime(value: string) {
  const date = new Date(value); if (Number.isNaN(date.valueOf())) return '—';
  const now = new Date(); const today = date.toDateString() === now.toDateString();
  if (today) return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Hôm qua';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(date);
}
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
async function json<T>(response: Response): Promise<T> { const text = await response.text(); if (!text) return {} as T; try { return JSON.parse(text) as T; } catch { return { message: `API không phản hồi JSON (HTTP ${response.status})` } as T; } }
function errorMessage(body: unknown, fallback: string) { if (!body || typeof body !== 'object' || !('message' in body)) return fallback; const value = (body as { message?: unknown }).message; return typeof value === 'string' ? value : Array.isArray(value) ? value.join('. ') : fallback; }
