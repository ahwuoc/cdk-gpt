import { processPurchaseAlertTask, purchaseAlertTaskFrom, taskRequestIsAuthorized } from '@/lib/serverless-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!taskRequestIsAuthorized(request)) return Response.json({ message: 'Unauthorized task request' }, { status: 401 });
  const task = purchaseAlertTaskFrom(await request.json().catch(() => undefined));
  if (!task) return Response.json({ message: 'Invalid purchase alert task' }, { status: 400 });
  return Response.json(await processPurchaseAlertTask(task));
}
