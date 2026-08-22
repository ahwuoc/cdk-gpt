export interface AppConfig {
  /** `serverless` is selected automatically in Vercel, or explicitly with APP_RUNTIME. */
  appRuntime: 'server' | 'serverless';
  nodeEnv: string;
  mongoUri: string;
  /** Redis is only required by the long-running Docker/BullMQ runtime. */
  redisUrl: string;
  /** Keep Atlas connection usage bounded when one serverless function scales out. */
  mongoMaxPoolSize: number;
  botToken: string;
  adminTelegramIds: string[];
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessExpiresIn: string;
  jwtRefreshExpiresIn: string;
  encryptionKey: string;
  encryptionKeyVersion: number;
  webAppUrl: string;
  apiUrl: string;
  shopName: string;
  /** Optional token for the external bank transaction-history provider. */
  tokenApiBank: string;
  bankHistoryApiUrl: string;
  bankPollSeconds: number;
  bankTopupTtlMinutes: number;
  deliveryAttempts: number;
  deliveryBackoffMs: number;
  botConfigPollSeconds: number;
}

export interface RedisConnectionOptions {
  host: string; port: number; username?: string; password?: string; db?: number; tls?: Record<string, never>;
}

/**
 * Keep the deployment decision in one small helper so timers/workers never get
 * accidentally started in a Vercel Function. `VERCEL` is set by Vercel at
 * runtime; APP_RUNTIME also makes local serverless testing possible.
 */
export function isServerlessRuntime(env: Record<string, string | undefined> = process.env) {
  const configured = env.APP_RUNTIME;
  if (configured && configured !== 'server' && configured !== 'serverless') {
    throw new Error('APP_RUNTIME must be either server or serverless');
  }
  return configured === 'serverless' || (!configured && Boolean(env.VERCEL));
}

export function redisConnectionOptions(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('REDIS_URL must use redis:// or rediss://');
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  if (db !== undefined && (!Number.isSafeInteger(db) || db < 0)) throw new Error('REDIS_URL contains an invalid database number');
  return { host: url.hostname, port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}), ...(db !== undefined ? { db } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}) };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const required = (name: string, developmentFallback?: string): string => {
    const value = env[name] ?? (env.NODE_ENV !== 'production' ? developmentFallback : undefined);
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };

  const appRuntime: AppConfig['appRuntime'] = isServerlessRuntime(env) ? 'serverless' : 'server';
  const encryptionKeyVersion = Number(env.ENCRYPTION_KEY_VERSION ?? 1);
  if (!Number.isSafeInteger(encryptionKeyVersion) || encryptionKeyVersion < 1) {
    throw new Error('ENCRYPTION_KEY_VERSION must be a positive integer');
  }
  const deliveryAttempts = Number(env.DELIVERY_ATTEMPTS ?? 6);
  const deliveryBackoffMs = Number(env.DELIVERY_BACKOFF_MS ?? 5000);
  const botConfigPollSeconds = Number(env.BOT_CONFIG_POLL_SECONDS ?? 15);
  const bankPollSeconds = Number(env.BANK_POLL_SECONDS ?? 20);
  const bankTopupTtlMinutes = Number(env.BANK_TOPUP_TTL_MINUTES ?? 20);
  const mongoMaxPoolSize = Number(env.MONGODB_MAX_POOL_SIZE ?? (appRuntime === 'serverless' ? 5 : 20));
  if (!Number.isSafeInteger(deliveryAttempts) || deliveryAttempts < 1 || !Number.isSafeInteger(deliveryBackoffMs) || deliveryBackoffMs < 0) {
    throw new Error('DELIVERY_ATTEMPTS and DELIVERY_BACKOFF_MS must be non-negative integers, with at least one attempt');
  }
  if (!Number.isSafeInteger(botConfigPollSeconds) || botConfigPollSeconds < 5) {
    throw new Error('BOT_CONFIG_POLL_SECONDS must be an integer of at least 5 seconds');
  }
  if (!Number.isSafeInteger(bankPollSeconds) || bankPollSeconds < 10) {
    throw new Error('BANK_POLL_SECONDS must be an integer of at least 10 seconds');
  }
  if (!Number.isSafeInteger(bankTopupTtlMinutes) || bankTopupTtlMinutes < 5 || bankTopupTtlMinutes > 24 * 60) {
    throw new Error('BANK_TOPUP_TTL_MINUTES must be an integer between 5 and 1440');
  }
  if (!Number.isSafeInteger(mongoMaxPoolSize) || mongoMaxPoolSize < 1 || mongoMaxPoolSize > 100) {
    throw new Error('MONGODB_MAX_POOL_SIZE must be an integer between 1 and 100');
  }

  return {
    appRuntime,
    nodeEnv: env.NODE_ENV ?? 'development',
    mongoUri: required('MONGODB_URI', 'mongodb://localhost:27017/digital_store?replicaSet=rs0'),
    // Serverless mode uses HTTP task delivery (QStash) rather than a
    // long-running BullMQ worker, so it must not force Vercel users to buy a
    // Redis instance they do not use. The Docker/worker runtime stays strict.
    redisUrl: appRuntime === 'serverless' ? (env.REDIS_URL ?? '') : required('REDIS_URL', 'redis://localhost:6379'),
    mongoMaxPoolSize,
    botToken: env.BOT_TOKEN ?? '',
    adminTelegramIds: (env.ADMIN_TELEGRAM_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    jwtAccessSecret: required('JWT_ACCESS_SECRET', 'development-access-secret-change-me'),
    jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'development-refresh-secret-change-me'),
    jwtAccessExpiresIn: env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    jwtRefreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    encryptionKey: required('ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef'),
    encryptionKeyVersion,
    webAppUrl: env.WEB_APP_URL ?? 'http://localhost:3000',
    apiUrl: env.API_URL ?? 'http://localhost:3001',
    shopName: env.SHOP_NAME ?? 'Digital Store',
    tokenApiBank: env.TOKEN_API_BANK ?? '',
    bankHistoryApiUrl: (env.BANK_HISTORY_API_URL ?? 'https://thueapibank.vn/historyapicakev2').replace(/\/+$/, ''),
    bankPollSeconds,
    bankTopupTtlMinutes,
    deliveryAttempts,
    deliveryBackoffMs,
    botConfigPollSeconds,
  };
}
