import { getServerlessApi } from '../../../../api/src/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = { params: Promise<{ path?: string[] }> };
type InjectMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

async function dispatch(request: Request, _context: RouteContext) {
  const app = await getServerlessApi();
  const fastify = app.getHttpAdapter().getInstance();
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers.entries());
  // Fastify inject accepts a Buffer and preserves the exact JSON payload for
  // validation/webhook routes. GET/HEAD do not have a body.
  const payload = request.method === 'GET' || request.method === 'HEAD'
    ? undefined : Buffer.from(await request.arrayBuffer());
  const injected = await fastify.inject({
    method: request.method as InjectMethod,
    url: `${url.pathname}${url.search}`,
    headers,
    payload,
  });
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(injected.headers)) {
    if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, String(item)));
    else if (value !== undefined) responseHeaders.set(name, String(value));
  }
  return new Response(request.method === 'HEAD' ? null : injected.body, {
    status: injected.statusCode,
    headers: responseHeaders,
  });
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const OPTIONS = dispatch;
