'use client';

import { FormEvent, useState } from 'react';
import { Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import type { CategoryRecord } from './product-manager';
import { requestId } from './request-id';

interface CategoryInput { name: string; slug: string; description: string; sortOrder: number; }
const emptyCategory: CategoryInput = { name: '', slug: '', description: '', sortOrder: 0 };

export function CategoryManager({ categories, authorized, reload, setMessage }: {
  categories: CategoryRecord[];
  authorized(path: string, init?: RequestInit): Promise<Response>;
  reload(): Promise<void>;
  setMessage(message: string): void;
}) {
  const [draft, setDraft] = useState<CategoryInput>(emptyCategory);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() { setDraft(emptyCategory); setEditingId(null); }
  function edit(category: CategoryRecord) {
    setEditingId(category._id); setDraft({ name: category.name, slug: category.slug, description: category.description ?? '', sortOrder: category.sortOrder });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const response = await authorized(`/admin/categories${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId() }, body: JSON.stringify(draft),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Không thể lưu danh mục');
      await reload(); reset(); setMessage(editingId ? `Đã cập nhật danh mục ${body.name}.` : `Đã tạo danh mục ${body.name}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu danh mục'); }
    finally { setSaving(false); }
  }
  async function archive(category: CategoryRecord) {
    if (!window.confirm(`Lưu trữ danh mục “${category.name}”?`)) return;
    setSaving(true); setMessage('');
    try {
      const response = await authorized(`/admin/categories/${category._id}`, { method: 'DELETE', headers: { 'x-request-id': requestId() } });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Không thể lưu trữ danh mục');
      await reload(); if (editingId === category._id) reset(); setMessage(`Đã lưu trữ danh mục ${category.name}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu trữ danh mục'); }
    finally { setSaving(false); }
  }

  return <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
    <div className="mb-5 flex items-start justify-between gap-3"><div className="flex gap-3 text-indigo-400"><Plus /><div><h2 className="font-semibold text-slate-100">Quản lý danh mục</h2><p className="mt-1 text-xs leading-5 text-slate-400">Phân loại sản phẩm để tìm và quản lý nhanh hơn.</p></div></div>{editingId && <button type="button" onClick={reset} className="button-secondary flex items-center gap-2 px-3 py-2"><X size={15} />Hủy sửa</button>}</div>
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_1fr_100px_auto]"><input className="input" placeholder="Tên danh mục" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /><input className="input font-mono" placeholder="slug-danh-muc" value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: slugify(event.target.value) })} required /><input className="input" type="number" min="0" step="1" placeholder="Thứ tự" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} /><button disabled={saving} className="button-primary flex items-center justify-center gap-2"><Save size={15} />{editingId ? 'Lưu' : 'Thêm'}</button><textarea className="input md:col-span-3" placeholder="Mô tả (không bắt buộc)" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></form>
    <div className="mt-5 space-y-2">{categories.map((category) => <div key={category._id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3"><div><p className="font-medium">{category.name}</p><p className="font-mono text-xs text-slate-500">{category.slug}{category.description ? ` · ${category.description}` : ''}</p></div><div className="flex gap-2"><button type="button" disabled={saving} onClick={() => edit(category)} className="button-secondary p-2" title="Sửa"><Pencil size={14} /></button><button type="button" disabled={saving} onClick={() => void archive(category)} className="rounded-xl border border-rose-900/60 p-2 text-rose-400" title="Lưu trữ"><Trash2 size={14} /></button></div></div>)}{categories.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">Chưa có danh mục.</p>}</div>
    <button type="button" disabled={saving} onClick={() => void reload()} className="button-secondary mt-4 flex items-center gap-2 px-3 py-2"><RefreshCw size={15} />Tải lại danh mục</button>
  </div>;
}

function slugify(value: string) { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
