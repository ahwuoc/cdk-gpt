import { deliveryTaskFrom, processDeliveryTask, taskRequestIsAuthorized } from '@/lib/serverless-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!taskRequestIsAuthorized(request)) return Response.json({ message: 'Unauthorized task request' }, { status: 401 });
  const task = deliveryTaskFrom(await request.json().catch(() => undefined));
  if (!task) return Response.json({ message: 'Invalid delivery task' }, { status: 400 });
  const retried = Number(request.headers.get('upstash-retried') ?? 0);
  const result = await processDeliveryTask(task.orderId, Number.isSafeInteger(retried) && retried >= 0 ? retried : 0);
  return Response.json(result);
}
