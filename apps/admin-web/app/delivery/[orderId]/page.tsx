import { notFound } from 'next/navigation';
import { Download, KeyRound, ShieldCheck } from 'lucide-react';
import { deliveryTextFile, getPublicDelivery } from '@/lib/public-delivery';
import { CopyButton } from './copy-button';

export const dynamic = 'force-dynamic';

export default async function DeliveryPage({ params, searchParams }: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.token === 'string' ? query.token : '';
  const data = await getPublicDelivery(orderId, token).catch(() => null);
  if (!data) notFound();
  const fileUrl = `/api/delivery/${encodeURIComponent(orderId)}/file?token=${encodeURIComponent(token)}`;
  const fileText = deliveryTextFile(data);
  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/40">
        <div className="border-b border-slate-800 bg-gradient-to-br from-indigo-600/30 via-slate-900 to-slate-900 p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200"><ShieldCheck size={14} /> Giao hàng thành công</p>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">{data.productName}</h1>
              <p className="mt-2 font-mono text-sm text-indigo-200">{data.orderCode}</p>
            </div>
            <a href={fileUrl} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"><Download size={17} />Tải file TXT</a>
          </div>
        </div>

        <div className="space-y-5 p-5 sm:p-8">
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-white"><KeyRound size={18} className="text-indigo-300" />Thông tin tài khoản</h2>
              <CopyButton text={data.formatted} />
            </div>
            <pre className="max-h-[60vh] w-full overflow-auto whitespace-pre rounded-xl bg-black/35 p-4 font-mono text-sm leading-7 text-amber-100">{data.formatted}</pre>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {data.instructions && <InfoBlock title="Hướng dẫn sử dụng" body={data.instructions} />}
            {(data.warrantyPolicy || data.warrantyDays > 0) && <InfoBlock title="Bảo hành" body={[data.warrantyDays > 0 ? `Thời gian: ${data.warrantyDays} ngày` : '', data.warrantyPolicy].filter(Boolean).join('\n')} />}
          </section>

          <aside className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="text-sm leading-6 text-slate-300">
              <h3 className="font-semibold text-white">Lưu ý</h3>
              <ul className="mt-3 grid gap-2 lg:grid-cols-3">
                <li>• Lưu lại file TXT để tránh mất link.</li>
                <li>• Không chia sẻ link này cho người khác.</li>
                <li>• Nếu tài khoản lỗi, quay lại bot và gửi khiếu nại theo mã đơn.</li>
              </ul>
            </div>
            <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(fileText)}`} download={`${data.orderCode}.txt`} className="button-secondary flex w-full items-center justify-center gap-2 px-4 py-3 lg:w-auto"><Download size={16} />Tải nhanh trong trình duyệt</a>
          </aside>
        </div>
      </section>
    </div>
  </main>;
}

function InfoBlock({ title, body }: { title: string; body: string }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><h2 className="font-semibold text-white">{title}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">{body}</p></section>;
}
