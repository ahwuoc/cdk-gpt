import { deliveryTextFile, getPublicDelivery, safeDeliveryFilename } from '@/lib/public-delivery';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const data = await getPublicDelivery(orderId, token).catch(() => null);
  if (!data) return new Response('Không tìm thấy đơn hoặc link đã sai.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const filename = safeDeliveryFilename(data);
  return new Response(deliveryTextFile(data), { headers: {
    'content-type': 'text/plain; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'private, no-store',
  } });
}
