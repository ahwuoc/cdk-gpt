'use client';

import { FormEvent, useState } from 'react';
import { PackagePlus, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { requestId } from './request-id';
import { missingDeliveryTemplateKeys, normalizeProductFieldKey, synchronizedInventoryFormat,
  unknownDeliveryTemplateKeys } from './product-form-utils';

type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type ProductFieldType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'EMAIL' | 'URL';

interface ProductField {
  name: string; key: string; type: ProductFieldType; sensitive: boolean;
  visibleToCustomer: boolean; required: boolean; sortOrder: number;
}

interface ProductInput {
  name: string; slug: string; description: string; price: number; status: ProductStatus; imageUrls: string[];
  categoryId?: string;
  instructions: string; warrantyPolicy: string; warrantyDays: number; deliveryTemplate: string;
  fieldDefinitions: ProductField[]; inventoryPattern: string;
  purchaseLimitPerUser: number; lowStockThreshold: number; sortOrder: number;
}

export interface ProductRecord extends ProductInput {
  _id: string; availableStock: number; reservedStock: number; soldStock: number;
}

export interface CategoryRecord { _id: string; name: string; slug: string; description?: string; sortOrder: number; }
export interface ProductPagination { page: number; limit: number; total: number; totalPages: number; }

const emptyProduct: ProductInput = {
  name: '', slug: '', description: '', price: 0, status: 'DRAFT', imageUrls: [], categoryId: undefined, instructions: '',
  warrantyPolicy: '', warrantyDays: 0, deliveryTemplate: 'Tài khoản: {{login}}\nMật khẩu: {{password}}',
  fieldDefinitions: [
    { name: 'Tài khoản', key: 'login', type: 'STRING', sensitive: false, visibleToCustomer: true, required: true, sortOrder: 1 },
    { name: 'Mật khẩu', key: 'password', type: 'STRING', sensitive: true, visibleToCustomer: true, required: true, sortOrder: 2 },
  ],
  inventoryPattern: '{{login}}----{{password}}',
  purchaseLimitPerUser: 0, lowStockThreshold: 5, sortOrder: 0,
};

export function ProductManager({ products, categories, pagination, authorized, reload, selectProduct, setMessage, onPageChange }: {
  products: ProductRecord[];
  categories: CategoryRecord[];
  pagination: ProductPagination;
  authorized(path: string, init?: RequestInit): Promise<Response>;
  reload(): Promise<void>;
  selectProduct(id: string): void;
  setMessage(message: string): void;
  onPageChange(page: number): void;
}) {
  const [draft, setDraft] = useState<ProductInput>(emptyProduct);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasInventory, setHasInventory] = useState(false);
  const [originalFieldCount, setOriginalFieldCount] = useState(0);

  function reset() { setDraft(emptyProduct); setEditingId(null); setHasInventory(false); setOriginalFieldCount(0); }

  function edit(product: ProductRecord) {
    setEditingId(product._id); setDraft(productInput(product));
    setHasInventory(product.availableStock + product.reservedStock + product.soldStock > 0);
    setOriginalFieldCount(product.fieldDefinitions.length); setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fieldDefinitions = draft.fieldDefinitions.map((field) => ({ ...field, key: field.key.trim(), type: 'STRING' as const }));
    const normalized = { ...draft, fieldDefinitions };
    const needsTemplateSync = unknownDeliveryTemplateKeys(fieldDefinitions, draft.deliveryTemplate).length > 0
      || missingDeliveryTemplateKeys(fieldDefinitions, draft.deliveryTemplate).length > 0;
    const input = needsTemplateSync ? { ...normalized, ...synchronizedInventoryFormat(fieldDefinitions) } : normalized;
    if (input !== draft) setDraft(input);
    await save(input, editingId);
  }

  async function save(input: ProductInput, id: string | null) {
    setSaving(true); setMessage('');
    try {
      validateProductInput(input);
      const response = await authorized(`/admin/products${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId() },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(productErrorMessage(body));
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
        method: 'DELETE', headers: { 'x-request-id': requestId() },
      });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Không thể lưu trữ sản phẩm');
      await reload(); if (editingId === product._id) reset();
      setMessage(`Đã lưu trữ ${product.name}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu trữ sản phẩm'); }
    finally { setSaving(false); }
  }

  function updateField(index: number, patch: Partial<ProductField>) {
    setDraft((current) => {
      const previous = current.fieldDefinitions[index];
      const fieldDefinitions = current.fieldDefinitions.map((field, position) => position === index ? { ...field, ...patch } : field);
      if (!previous || !patch.key || patch.key === previous.key) return { ...current, fieldDefinitions };
      return {
        ...current,
        fieldDefinitions,
        inventoryPattern: replacePatternKey(current.inventoryPattern, previous.key, patch.key),
        deliveryTemplate: replaceTemplateKey(current.deliveryTemplate, previous.key, patch.key),
      };
    });
  }

  function addField() {
    if (draft.fieldDefinitions.length >= 100) { setMessage('Mỗi sản phẩm hỗ trợ tối đa 100 trường dữ liệu.'); return; }
    setDraft((current) => ({ ...current, fieldDefinitions: [...current.fieldDefinitions, {
      name: 'Trường mới', key: `field${current.fieldDefinitions.length + 1}`, type: 'STRING' as const,
      sensitive: true, visibleToCustomer: true, required: !hasInventory, sortOrder: current.fieldDefinitions.length + 1,
    }] }));
  }

  function refreshInventoryFormat() {
    setDraft((current) => ({ ...current, ...synchronizedInventoryFormat(current.fieldDefinitions) }));
    setMessage('Đã đồng bộ pattern nhập kho và template giao hàng theo các key hiện tại.');
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
          <Field label="Danh mục"><select className="input" value={draft.categoryId ?? ''} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value || undefined })}><option value="">Chưa phân loại</option>{categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}</select></Field>
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
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-slate-200">Cấu trúc dữ liệu kho</p><p className="text-xs text-slate-500">Mọi trường đều là text. Bạn có thể tự đặt tên/key, thêm hoặc xóa trường; pattern và mẫu giao hàng sẽ đồng bộ theo key.</p></div><button type="button" onClick={addField} className="button-secondary flex shrink-0 items-center gap-2 px-3 py-2"><Plus size={15} />Thêm trường</button></div>
          {hasInventory && <div className="mb-3 rounded-xl border border-indigo-500/25 bg-indigo-500/10 p-3 text-xs leading-5 text-indigo-100"><b>Bạn vẫn đổi được key cũ.</b> Khi lưu, hệ thống sẽ đổi key trong toàn bộ hàng đã nhập và mã hóa lại an toàn. “Nhạy cảm” và “Gửi cho khách” của trường cũ vẫn được khóa để tránh làm lộ hoặc mất dữ liệu.</div>}
          <div className="space-y-3">{draft.fieldDefinitions.map((field, index) => {
            const existingField = hasInventory && index < originalFieldCount;
            const newFieldOnExistingStock = hasInventory && !existingField;
            const keyError = productFieldKeyError(field.key);
            return <div key={`${field.key}-${index}`} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 md:grid-cols-[1fr_1fr_auto]">
              <label><span className="mb-1 block text-[11px] font-medium text-slate-500">Tên hiển thị</span><input className="input" value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} placeholder="API key" required /></label>
              <label><span className="mb-1 block text-[11px] font-medium text-slate-500">Key dữ liệu (text tự do)</span><input className="input font-mono" value={field.key} onChange={(event) => updateField(index, { key: normalizeProductFieldKey(event.target.value) })} placeholder="2fa, tài khoản phụ, api-key…" maxLength={64} spellCheck={false} aria-invalid={Boolean(keyError)} required />{keyError ? <span className="mt-1 block text-[10px] text-rose-400">{keyError}</span> : <span className="mt-1 block text-[10px] text-slate-600">Tối đa 64 ký tự; không dùng dấu chấm, $, {'{ }'} hoặc ký tự xuống dòng.</span>}</label>
              <button type="button" disabled={draft.fieldDefinitions.length === 1 || existingField} onClick={() => setDraft({ ...draft, fieldDefinitions: draft.fieldDefinitions.filter((_, position) => position !== index) })} className="mt-5 rounded-xl border border-rose-900/60 px-3 text-rose-400 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={16} /></button>
              <div className="flex flex-wrap gap-4 text-xs text-slate-400 md:col-span-4">
                <Check label="Bắt buộc" checked={field.required} disabled={newFieldOnExistingStock} onChange={(checked) => updateField(index, { required: checked })} />
                <Check label="Nhạy cảm" checked={field.sensitive} disabled={existingField} onChange={(checked) => updateField(index, { sensitive: checked })} />
                <Check label="Gửi cho khách" checked={field.visibleToCustomer} disabled={existingField} onChange={(checked) => updateField(index, { visibleToCustomer: checked })} />
                {newFieldOnExistingStock && <span className="text-amber-300">Trường mới phải để không bắt buộc khi còn hàng cũ.</span>}
              </div>
            </div>;
          })}</div>
        </div>
        <Field label="Pattern nhập kho — mỗi hàng một dòng">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">Sau khi thêm key, bấm nút để cập nhật cả pattern và nội dung giao cho khách.</span><button type="button" onClick={refreshInventoryFormat} className="button-secondary px-3 py-1.5 text-xs">Đồng bộ pattern &amp; template</button></div>
          <input className="input font-mono" value={draft.inventoryPattern} onChange={(event) => setDraft({ ...draft, inventoryPattern: event.target.value })} placeholder="{{email}}----{{password}}----{{2fa}}" required />
          <p className="mt-2 text-xs leading-5 text-slate-500">Có thể tùy biến chữ và dấu ngăn cách. Ví dụ <code>{'Email={{email}} | Pass={{password}} / 2FA={{2fa}}'}</code>. Phần trong <code>{'{{ }}'}</code> là key để hệ thống nhận đúng cột.</p>
        </Field>
        <Field label="Template giao hàng"><textarea className="input min-h-28 font-mono text-xs" value={draft.deliveryTemplate} onChange={(event) => setDraft({ ...draft, deliveryTemplate: event.target.value })} required /><p className="mt-2 text-xs text-slate-500">Ví dụ: <code>Tài khoản: {'{{login}}'} · Mật khẩu: {'{{password}}'}</code></p></Field>
        <button disabled={saving} className="button-primary flex w-full items-center justify-center gap-2"><Save size={16} />{saving ? 'Đang lưu…' : editingId ? 'Lưu thay đổi' : 'Tạo sản phẩm'}</button>
      </form>
    </div>

    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Danh sách sản phẩm</h2><p className="mt-1 text-xs text-slate-400">{pagination.total} sản phẩm · trang {pagination.page}/{Math.max(pagination.totalPages, 1)}</p></div><button type="button" disabled={saving} onClick={() => void reload()} className="button-secondary flex items-center gap-2 px-3 py-2"><RefreshCw size={15} />Tải lại</button></div>
      <div className="space-y-3">{products.map((product) => <div key={product._id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-medium">{product.name}</h3><Status value={product.status} /></div><p className="mt-1 font-mono text-xs text-slate-500">{product.slug} · ID {product._id}</p></div><p className="font-semibold text-indigo-300">{formatMoney(product.price)}</p></div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><Stock label="Có sẵn" value={product.availableStock} color="text-emerald-400" /><Stock label="Đang giữ" value={product.reservedStock} color="text-amber-400" /><Stock label="Đã bán" value={product.soldStock} color="text-slate-300" /></div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><button type="button" onClick={() => { selectProduct(product._id); setMessage(`Đã chọn ${product.name} để nhập kho.`); }} className="button-secondary py-2">Nhập kho</button><button type="button" onClick={() => edit(product)} className="button-secondary flex items-center justify-center gap-2 py-2"><Pencil size={14} />Sửa</button><button type="button" disabled={saving} onClick={() => void toggle(product)} className="button-secondary py-2">{product.status === 'ACTIVE' ? 'Tạm ngừng' : 'Bật bán'}</button><button type="button" disabled={saving} onClick={() => void archive(product)} className="rounded-xl border border-rose-900/60 px-3 py-2 text-sm text-rose-400 hover:bg-rose-950/30">Lưu trữ</button></div>
      </div>)}{products.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Chưa có sản phẩm. Điền biểu mẫu phía trên để tạo sản phẩm đầu tiên.</p>}
      {pagination.totalPages > 1 && <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4"><button type="button" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)} className="button-secondary px-3 py-2">Trang trước</button><span className="text-xs text-slate-400">{(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} / {pagination.total}</span><button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)} className="button-secondary px-3 py-2">Trang sau</button></div>}</div>
    </div>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><span className="label">{label}</span>{children}</div>; }
function NumberInput({ value, min, onChange }: { value: number; min?: number; onChange(value: number): void }) { return <input className="input" type="number" step="1" min={min} value={value} onChange={(event) => onChange(Number(event.target.value))} />; }
function Check({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void }) { return <label className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>; }
function Stock({ label, value, color }: { label: string; value: number; color: string }) { return <div className="rounded-lg bg-slate-900 p-2"><p className="text-slate-500">{label}</p><p className={`mt-1 text-base font-semibold ${color}`}>{value}</p></div>; }
function Status({ value }: { value: ProductStatus }) { const colors: Record<ProductStatus, string> = { ACTIVE: 'bg-emerald-500/15 text-emerald-400', DRAFT: 'bg-slate-500/15 text-slate-400', INACTIVE: 'bg-amber-500/15 text-amber-400', ARCHIVED: 'bg-rose-500/15 text-rose-400' }; return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${colors[value]}`}>{value}</span>; }
function slugify(value: string) { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function formatMoney(value: number) { return new Intl.NumberFormat('vi-VN').format(value) + ' đ'; }
function replacePatternKey(pattern: string, from: string, to: string) {
  if (pattern.includes('{{') || pattern.includes('}}')) {
    return pattern.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (whole, key: string) => key.trim() === from ? `{{${to}}}` : whole);
  }
  return pattern.replace(/[a-zA-Z0-9_]+/g, (key) => key === from ? to : key);
}
function replaceTemplateKey(template: string, from: string, to: string) { return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (whole, key: string) => key.trim() === from ? `{{${to}}}` : whole); }
function validateProductInput(input: ProductInput) {
  const invalid = input.fieldDefinitions.find((field) => productFieldKeyError(field.key));
  if (invalid) throw new Error(productFieldKeyError(invalid.key) ?? 'Key dữ liệu không hợp lệ.');
  const unknownTemplateKey = unknownDeliveryTemplateKeys(input.fieldDefinitions, input.deliveryTemplate)[0];
  if (unknownTemplateKey) throw new Error(`Template giao hàng vẫn còn key “${unknownTemplateKey}” không tồn tại. Bấm “Đồng bộ pattern & template” để sửa.`);
}
function productErrorMessage(body: unknown) {
  const raw = body && typeof body === 'object' && 'message' in body ? (body as { message?: unknown }).message : undefined;
  const message = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').join('. ') : typeof raw === 'string' ? raw : 'Không thể lưu sản phẩm';
  if (message.startsWith('Inventory field ') && message.includes('cannot be removed or reordered')) return 'Không thể xóa hoặc đổi thứ tự trường cũ khi sản phẩm đã có hàng trong kho.';
  if (message.startsWith('Inventory field ') && message.includes('visibility cannot change')) return 'Không thể đổi quyền “Nhạy cảm” hoặc “Gửi cho khách” của trường cũ khi sản phẩm đã có hàng trong kho.';
  if (message.startsWith('New inventory field ') && message.includes('must be optional')) return 'Khi sản phẩm đã có hàng cũ, trường mới phải bỏ chọn “Bắt buộc”.';
  if (message.includes('key rename must keep')) return 'Khi đổi key, hãy giữ nguyên ô “Bắt buộc” và thứ tự của trường đó.';
  if (message.includes('cannot be renamed to another existing field key')) return 'Key mới đang trùng với một key cũ khác. Hãy chọn một key mới, ví dụ api hoặc api_key.';
  if (message.startsWith('Delivery template contains unknown field:')) return `${message.replace('Delivery template contains unknown field:', 'Template giao hàng đang có key không tồn tại:')}. Bấm “Đồng bộ pattern & template” để sửa nhanh.`;
  if (message.startsWith('Inventory pattern contains unknown field:')) return `${message.replace('Inventory pattern contains unknown field:', 'Pattern đang có key không tồn tại:')}. Bấm “Đồng bộ pattern & template” để sửa nhanh.`;
  if (message.startsWith('Inventory pattern must include required field:')) return `${message.replace('Inventory pattern must include required field:', 'Pattern chưa có key bắt buộc:')}.`;
  return message;
}
function productInput(product: ProductRecord): ProductInput {
  return {
    name: product.name, slug: product.slug, description: product.description, price: product.price, status: product.status, categoryId: product.categoryId,
    imageUrls: product.imageUrls ?? [], instructions: product.instructions ?? '', warrantyPolicy: product.warrantyPolicy ?? '',
    warrantyDays: product.warrantyDays, deliveryTemplate: product.deliveryTemplate,
    fieldDefinitions: product.fieldDefinitions.map((field) => ({ ...field, type: 'STRING' })),
    inventoryPattern: product.inventoryPattern ?? synchronizedInventoryFormat(product.fieldDefinitions).inventoryPattern,
    purchaseLimitPerUser: product.purchaseLimitPerUser,
    lowStockThreshold: product.lowStockThreshold, sortOrder: product.sortOrder,
  };
}

function productFieldKeyError(value: string) {
  if (!value.trim()) return 'Key không được để trống.';
  if (value !== value.trim()) return 'Key không được có khoảng trắng ở đầu hoặc cuối.';
  if (value.length > 64) return 'Key tối đa 64 ký tự.';
  if (/[.$\u0000-\u001F\u007F{}]/u.test(value)) return 'Key không được chứa dấu chấm, $, { }, ký tự xuống dòng hoặc điều khiển.';
  return '';
}
