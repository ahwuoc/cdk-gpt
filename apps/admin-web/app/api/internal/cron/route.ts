import { cronRequestIsAuthorized, runServerlessMaintenance } from '@/lib/serverless-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Configure this path from Vercel Cron (Pro, minutely) or an external scheduler.
 * Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when that
 * environment variable is set.
 */
async function handleCron(request: Request) {
  if (!cronRequestIsAuthorized(request)) return Response.json({ message: 'Unauthorized cron request' }, { status: 401 });
  return Response.json(await runServerlessMaintenance());
}

/** Vercel Cron uses GET; QStash Schedule normally delivers with POST. */
export const GET = handleCron;
export const POST = handleCron;
