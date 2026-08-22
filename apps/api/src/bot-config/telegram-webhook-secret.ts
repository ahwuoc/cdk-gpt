import { createHmac } from 'node:crypto';

/** Telegram only permits URL-safe secrets up to 256 characters. */
export function isTelegramWebhookSecretSeed(value: string | undefined): value is string {
  // A seed must have enough entropy: this ends up protecting the public
  // Telegram webhook endpoint, so accepting a short user-supplied value
  // would make its derived HMAC header guessable.
  return Boolean(value && /^[A-Za-z0-9_-]{32,256}$/.test(value));
}

/**
 * Give every configured bot a distinct Telegram header secret. A token swap
 * can then reject an in-flight update from the old bot even though both bots
 * use the same webhook URL.
 */
export function deriveTelegramWebhookSecret(seed: string, botToken: string) {
  return createHmac('sha256', seed).update(botToken).digest('base64url');
}
