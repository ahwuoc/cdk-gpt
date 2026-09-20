/**
 * Tiny QStash REST client. Keeping this dependency-free makes the Vercel
 * bundle smaller while still giving serverless delivery durable retries.
 * QStash forwards X-Task-Secret to our task route; the route checks it before
 * doing any inventory/wallet-sensitive work.
 */
export interface QStashRuntimeConfig {
  endpoint: string;
  taskBaseUrl: string;
  token: string;
}

export class QStashTaskPublisher {
  constructor(private readonly resolveRuntime: () => Promise<QStashRuntimeConfig> = qstashConfigFromEnvironment) {}

  async publish(path: string, payload: Record<string, unknown>, options: { deduplicationId: string; retries?: number; delayMs?: number } ) {
    if (!path.startsWith('/')) throw new Error('Serverless task path must start with /');
    if (options.delayMs !== undefined && (!Number.isFinite(options.delayMs) || options.delayMs < 0
      || options.delayMs > 7 * 24 * 60 * 60_000)) throw new Error('Invalid serverless task delay');
    const runtime = await this.resolveRuntime();
    const taskSecret = requireEnv(process.env, 'TASK_QUEUE_SECRET');
    const endpoint = requireHttpsUrl(runtime.endpoint, 'QSTASH_URL').replace(/\/+$/, '');
    const taskBaseUrl = requireHttpsUrl(runtime.taskBaseUrl, 'TASK_BASE_URL or WEB_APP_URL');
    if (!runtime.token.trim()) throw new Error('QSTASH_TOKEN is required when APP_RUNTIME=serverless');
    const destination = `${taskBaseUrl}${path}`;
    const response = await fetch(`${endpoint}/v2/publish/${destination}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${runtime.token.trim()}`,
        'content-type': 'application/json',
        'upstash-forward-x-task-secret': taskSecret,
        'upstash-deduplication-id': options.deduplicationId,
        'upstash-retries': String(options.retries ?? 5),
        'upstash-timeout': '55s',
        ...(options.delayMs ? { 'upstash-delay': `${Math.ceil(options.delayMs / 1_000)}s` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Task queue publish failed with HTTP ${response.status}`);
  }
}

async function qstashConfigFromEnvironment(env: Record<string, string | undefined> = process.env): Promise<QStashRuntimeConfig> {
  return {
    token: requireEnv(env, 'QSTASH_TOKEN'),
    taskBaseUrl: requireHttpsUrl(env.TASK_BASE_URL ?? env.WEB_APP_URL, 'TASK_BASE_URL or WEB_APP_URL'),
    endpoint: requireHttpsUrl(env.QSTASH_URL ?? 'https://qstash.upstash.io', 'QSTASH_URL'),
  };
}

function requireEnv(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when APP_RUNTIME=serverless`);
  return value;
}

function requireHttpsUrl(value: string | undefined, name: string) {
  const text = value?.trim();
  if (!text || text.includes(',')) throw new Error(`${name} must contain one public HTTPS URL when APP_RUNTIME=serverless`);
  let url: URL;
  try { url = new URL(text); }
  catch { throw new Error(`${name} must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  return url.toString().replace(/\/$/, '');
}
