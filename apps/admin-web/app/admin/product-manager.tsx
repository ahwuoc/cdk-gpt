'use client';

import { FormEvent, useState } from 'react';
import { PackagePlus, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';

type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type ProductFieldType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'EMAIL' | 'URL';

interface ProductField {
  name: string; key: string; type: ProductFieldType; sensitive: boolean;
  visibleToCustomer: boolean; required: boolean; sortOrder: number;
}

interface ProductInput {
  name: string; slug: string; description: string; price: number; status: ProductStatus; imageUrls: string[];
  instructions: string; warrantyPolicy: string; warrantyDays: number; deliveryTemplate: string;
  fieldDefinitions: ProductField[]; purchaseLimitPerUser: number; lowStockThreshold: number; sortOrder: number;
}

export interface ProductRecord extends ProductInput {
  _id: string; availableStock: number; reservedStock: number; soldStock: number;
}

const emptyProduct: ProductInput = {
  name: '', slug: '', description: '', price: 0, status: 'DRAFT', imageUrls: [], instructions: '',
  warrantyPolicy: '', warrantyDays: 0, deliveryTemplate: 'Tài khoản: {{login}}\nMật khẩu: {{password}}',
  fieldDefinitions: [
    { name: 'Tài khoản', key: 'login', type: 'STRING', sensitive: false, visibleToCustomer: true, required: true, sortOrder: 1 },
    { name: 'Mật khẩu', key: 'password', type: 'STRING', sensitive: true, visibleToCustomer: true, required: true, sortOrder: 2 },
  ],
  purchaseLimitPerUser: 0, lowStockThreshold: 5, sortOrder: 0,
};

export function ProductManager({ products, authorized, reload, selectProduct, setMessage }: {
  products: ProductRecord[];
  authorized(path: string, init?: RequestInit): Promise<Response>;
  reload(): Promise<void>;
  selectProduct(id: string): void;
  setMessage(message: string): void;
}) {
  const [draft, setDraft] = useState<ProductInput>(emptyProduct);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() { setDraft(emptyProduct); setEditingId(null); }

  function edit(product: ProductRecord) {
    setEditingId(product._id); setDraft(productInput(product)); setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); await save(draft, editingId);
  }

  async function save(input: ProductInput, id: string | null) {
    setSaving(true); setMessage('');
    try {
      const response = await authorized(`/admin/products${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json', 'x-request-id': crypto.randomUUID() },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Không thể lưu sản phẩm');
      await reload(); selectProduct(body._id); reset();
      setMessage(id ? `Đã cập nhật ${body.name}.` : `Đã tạo sản phẩm ${body.name}. Bạn có thể nhập kho ngay bên dưới.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu sản phẩm'); }
    finally { setSaving(false); }
  }

  async function toggle(product: ProductRecord) {
    await save({ ...productInput(product), status: product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, product._id);
  }

  async function archive(product: ProductRecord) {
    if (!window.confirm(`Lưu trữ sản phẩm “${product.name}”? Sản phẩm sẽ không còn được bán.`)) return;
    setSaving(true); setMessage('');
    try {
      const response = await authorized(`/admin/products/${product._id}`, {
        method: 'DELETE', headers: { 'x-request-id': crypto.randomUUID() },
      });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Không thể lưu trữ sản phẩm');
      await reload(); if (editingId === product._id) reset();
      setMessage(`Đã lưu trữ ${product.name}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu trữ sản phẩm'); }
    finally { setSaving(false); }
  }

  function updateField(index: number, patch: Partial<ProductField>) {
    setDraft((current) => ({ ...current, fieldDefinitions: current.fieldDefinitions.map((field, position) =>
      position === index ? { ...field, ...patch } : field) }));
  }

  function addField() {
    setDraft((current) => ({ ...current, fieldDefinitions: [...current.fieldDefinitions, {
      name: 'Trường mới', key: `field${current.fieldDefinitions.length + 1}`, type: 'STRING' as const,
      sensitive: true, visibleToCustomer: true, required: true, sortOrder: current.fieldDefinitions.length + 1,
    }] }));
  }

  return <div className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex gap-3 text-indigo-400"><PackagePlus /><div><h2 className="font-semibold text-slate-100">{editingId ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h2><p className="mt-1 text-xs leading-5 text-slate-400">Tạo sản phẩm trước, sau đó chọn sản phẩm để nhập kho.</p></div></div>
        {editingId && <button type="button" onClick={reset} className="button-secondary flex items-center gap-2 px-3 py-2"><X size={15} />Hủy sửa</button>}
      </div>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Tên sản phẩm"><input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></Field>
          <Field label="Slug"><input className="input font-mono" value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: slugify(event.target.value) })} placeholder="tai-khoan-chatgpt" required /></Field>
          <Field label="Giá bán"><input className="input" type="number" min="0" step="1" value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} required /></Field>
          <Field label="Trạng thái"><select className="input" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProductStatus })}><option value="DRAFT">Bản nháp</option><option value="ACTIVE">Đang bán</option><option value="INACTIVE">Tạm ngừng</option></select></Field>
        </div>
        <Field label="Mô tả"><textarea className="input min-h-24" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} required /></Field>
        <Field label="URL hình ảnh — mỗi dòng một URL"><textarea className="input min-h-20 font-mono text-xs" value={draft.imageUrls.join('\n')} onChange={(event) => setDraft({ ...draft, imageUrls: event.target.value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) })} /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Hướng dẫn sử dụng"><textarea className="input min-h-24" value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></Field>
          <Field label="Chính sách bảo hành"><textarea className="input min-h-24" value={draft.warrantyPolicy} onChange={(event) => setDraft({ ...draft, warrantyPolicy: event.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Số ngày bảo hành"><NumberInput value={draft.warrantyDays} min={0} onChange={(value) => setDraft({ ...draft, warrantyDays: value })} /></Field>
          <Field label="Giới hạn mỗi khách"><NumberInput value={draft.purchaseLimitPerUser} min={0} onChange={(value) => setDraft({ ...draft, purchaseLimitPerUser: value })} /></Field>
          <Field label="Cảnh báo tồn kho"><NumberInput value={draft.lowStockThreshold} min={0} onChange={(value) => setDraft({ ...draft, lowStockThreshold: value })} /></Field>
          <Field label="Thứ tự hiển thị"><NumberInput value={draft.sortOrder} onChange={(value) => setDraft({ ...draft, sortOrder: value })} /></Field>
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-medium text-slate-200">Cấu trúc dữ liệu kho</p><p className="text-xs text-slate-500">Key được dùng trong JSON nhập kho và template giao hàng.</p></div><button type="button" onClick={addField} className="button-secondary flex items-center gap-2 px-3 py-2"><Plus size={15} />Thêm trường</button></div>
          <div className="space-y-3">{draft.fieldDefinitions.map((field, index) => <div key={`${field.key}-${index}`} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 md:grid-cols-[1fr_1fr_140px_auto]">
            <input className="input" value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} placeholder="Tên hiển thị" required />
            <input className="input font-mono" value={field.key} onChange={(event) => updateField(index, { key: event.target.value })} placeholder="key" required />
            <select className="input" value={field.type} onChange={(event) => updateField(index, { type: event.target.value as ProductFieldType })}>{['STRING', 'EMAIL', 'URL', 'NUMBER', 'BOOLEAN'].map((type) => <option key={type}>{type}</option>)}</select>
            <button type="button" disabled={draft.fieldDefinitions.length === 1} onClick={() => setDraft({ ...draft, fieldDefinitions: draft.fieldDefinitions.filter((_, position) => position !== index) })} className="rounded-xl border border-rose-900/60 px-3 text-rose-400 disabled:opacity-30"><Trash2 size={16} /></button>
            <div className="flex flex-wrap gap-4 text-xs text-slate-400 md:col-span-4">
              <Check label="Bắt buộc" checked={field.required} onChange={(checked) => updateField(index, { required: checked })} />
              <Check label="Nhạy cảm" checked={field.sensitive} onChange={(checked) => updateField(index, { sensitive: checked })} />
              <Check label="Gửi cho khách" checked={field.visibleToCustomer} onChange={(checked) => updateField(index, { visibleToCustomer: checked })} />
            </div>
          </div>)}</div>
        </div>
        <Field label="Template giao hàng"><textarea className="input min-h-28 font-mono text-xs" value={draft.deliveryTemplate} onChange={(event) => setDraft({ ...draft, deliveryTemplate: event.target.value })} required /><p className="mt-2 text-xs text-slate-500">Ví dụ: <code>Tài khoản: {'{{login}}'} · Mật khẩu: {'{{password}}'}</code></p></Field>
        <button disabled={saving} className="button-primary flex w-full items-center justify-center gap-2"><Save size={16} />{saving ? 'Đang lưu…' : editingId ? 'Lưu thay đổi' : 'Tạo sản phẩm'}</button>
      </form>
    </div>

    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Danh sách sản phẩm</h2><p className="mt-1 text-xs text-slate-400">{products.length} sản phẩm đang quản lý</p></div><button type="button" disabled={saving} onClick={() => void reload()} className="button-secondary flex items-center gap-2 px-3 py-2"><RefreshCw size={15} />Tải lại</button></div>
      <div className="space-y-3">{products.map((product) => <div key={product._id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-medium">{product.name}</h3><Status value={product.status} /></div><p className="mt-1 font-mono text-xs text-slate-500">{product.slug} · ID {product._id}</p></div><p className="font-semibold text-indigo-300">{formatMoney(product.price)}</p></div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><Stock label="Có sẵn" value={product.availableStock} color="text-emerald-400" /><Stock label="Đang giữ" value={product.reservedStock} color="text-amber-400" /><Stock label="Đã bán" value={product.soldStock} color="text-slate-300" /></div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><button type="button" onClick={() => { selectProduct(product._id); setMessage(`Đã chọn ${product.name} để nhập kho.`); }} className="button-secondary py-2">Nhập kho</button><button type="button" onClick={() => edit(product)} className="button-secondary flex items-center justify-center gap-2 py-2"><Pencil size={14} />Sửa</button><button type="button" disabled={saving} onClick={() => void toggle(product)} className="button-secondary py-2">{product.status === 'ACTIVE' ? 'Tạm ngừng' : 'Bật bán'}</button><button type="button" disabled={saving} onClick={() => void archive(product)} className="rounded-xl border border-rose-900/60 px-3 py-2 text-sm text-rose-400 hover:bg-rose-950/30">Lưu trữ</button></div>
      </div>)}{products.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Chưa có sản phẩm. Điền biểu mẫu phía trên để tạo sản phẩm đầu tiên.</p>}</div>
    </div>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function NumberInput({ value, min, onChange }: { value: number; min?: number; onChange(value: number): void }) { return <input className="input" type="number" step="1" min={min} value={value} onChange={(event) => onChange(Number(event.target.value))} />; }
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) { return <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>; }
function Stock({ label, value, color }: { label: string; value: number; color: string }) { return <div className="rounded-lg bg-slate-900 p-2"><p className="text-slate-500">{label}</p><p className={`mt-1 text-base font-semibold ${color}`}>{value}</p></div>; }
function Status({ value }: { value: ProductStatus }) { const colors: Record<ProductStatus, string> = { ACTIVE: 'bg-emerald-500/15 text-emerald-400', DRAFT: 'bg-slate-500/15 text-slate-400', INACTIVE: 'bg-amber-500/15 text-amber-400', ARCHIVED: 'bg-rose-500/15 text-rose-400' }; return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${colors[value]}`}>{value}</span>; }
function slugify(value: string) { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function formatMoney(value: number) { return new Intl.NumberFormat('vi-VN').format(value) + ' đ'; }
function productInput(product: ProductRecord): ProductInput {
  return {
    name: product.name, slug: product.slug, description: product.description, price: product.price, status: product.status,
    imageUrls: product.imageUrls ?? [], instructions: product.instructions ?? '', warrantyPolicy: product.warrantyPolicy ?? '',
    warrantyDays: product.warrantyDays, deliveryTemplate: product.deliveryTemplate,
    fieldDefinitions: product.fieldDefinitions.map((field) => ({ ...field })), purchaseLimitPerUser: product.purchaseLimitPerUser,
    lowStockThreshold: product.lowStockThreshold, sortOrder: product.sortOrder,
  };
}
