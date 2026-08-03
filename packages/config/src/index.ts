export interface AppConfig {
  nodeEnv: string;
  mongoUri: string;
  redisUrl: string;
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
  deliveryAttempts: number;
  deliveryBackoffMs: number;
  botConfigPollSeconds: number;
}

export interface RedisConnectionOptions {
  host: string; port: number; username?: string; password?: string; db?: number; tls?: Record<string, never>;
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

  const encryptionKeyVersion = Number(env.ENCRYPTION_KEY_VERSION ?? 1);
  if (!Number.isSafeInteger(encryptionKeyVersion) || encryptionKeyVersion < 1) {
    throw new Error('ENCRYPTION_KEY_VERSION must be a positive integer');
  }
  const deliveryAttempts = Number(env.DELIVERY_ATTEMPTS ?? 6);
  const deliveryBackoffMs = Number(env.DELIVERY_BACKOFF_MS ?? 5000);
  const botConfigPollSeconds = Number(env.BOT_CONFIG_POLL_SECONDS ?? 15);
  if (!Number.isSafeInteger(deliveryAttempts) || deliveryAttempts < 1 || !Number.isSafeInteger(deliveryBackoffMs) || deliveryBackoffMs < 0) {
    throw new Error('DELIVERY_ATTEMPTS and DELIVERY_BACKOFF_MS must be non-negative integers, with at least one attempt');
  }
  if (!Number.isSafeInteger(botConfigPollSeconds) || botConfigPollSeconds < 5) {
    throw new Error('BOT_CONFIG_POLL_SECONDS must be an integer of at least 5 seconds');
  }

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    mongoUri: required('MONGODB_URI', 'mongodb://localhost:27017/digital_store?replicaSet=rs0'),
    redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
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
    deliveryAttempts,
    deliveryBackoffMs,
    botConfigPollSeconds,
  };
}
