import { cronRequestIsAuthorized, runServerlessMaintenance } from '@/lib/serverless-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily Vercel Hobby maintenance only; bank credit uses the signed Cake
 * callback and never depends on this route. Vercel automatically sends
 * `Authorization: Bearer $CRON_SECRET`.
 */
async function handleCron(request: Request) {
  if (!cronRequestIsAuthorized(request)) return Response.json({ message: 'Unauthorized cron request' }, { status: 401 });
  return Response.json(await runServerlessMaintenance());
}

/** Vercel Cron uses GET; QStash Schedule normally delivers with POST. */
export const GET = handleCron;
export const POST = handleCron;
