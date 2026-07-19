/**
 * Direct Microsoft OAuth + Outlook IMAP (no DongVanFB).
 * Same approach as openai-register-paylink-ui-share email-server.
 */

const IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access';

const TOKEN_ENDPOINTS = [
  {
    name: 'V1-COMMON',
    url: 'https://login.microsoftonline.com/common/oauth2/token',
    scope: '',
    resource: 'https://outlook.office.com/',
  },
  {
    name: 'V1-CONSUMERS',
    url: 'https://login.microsoftonline.com/consumers/oauth2/token',
    scope: '',
    resource: 'https://outlook.office.com/',
  },
  { name: 'LIVE', url: 'https://login.live.com/oauth20_token.srf', scope: '' },
  { name: 'LIVE+scope', url: 'https://login.live.com/oauth20_token.srf', scope: IMAP_SCOPE },
  {
    name: 'CONSUMERS',
    url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    scope: IMAP_SCOPE,
  },
  {
    name: 'CONSUMERS-noscope',
    url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    scope: '',
  },
  {
    name: 'COMMON',
    url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: IMAP_SCOPE,
  },
  {
    name: 'COMMON-noscope',
    url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: '',
  },
] as const;

export async function refreshHotmailAccessToken(
  refreshToken: string,
  clientId: string
): Promise<{ accessToken: string; endpoint: string }> {
  const errors: string[] = [];

  for (const ep of TOKEN_ENDPOINTS) {
    const params = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (ep.scope) params.set('scope', ep.scope);
    if ('resource' in ep && ep.resource) params.set('resource', ep.resource);

    try {
      const resp = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
      });
      const text = await resp.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }

      if (resp.ok && data.access_token) {
        return { accessToken: String(data.access_token), endpoint: ep.name };
      }

      const msg = data.error_description || data.error || `HTTP ${resp.status}`;
      errors.push(`${ep.name}: ${msg}`);
    } catch (e: any) {
      errors.push(`${ep.name}: ${e?.message || e}`);
    }
  }

  throw new Error('Tất cả endpoint Microsoft Token đều thất bại → ' + errors.join(' | '));
}

export function extractOtpCode(text: string): string {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  const patterns = [
    /(?:OpenAI|ChatGPT|verification|verify|code|mã|xác minh|验证码|登录码)[^\d]{0,100}(\d{6})/i,
    /\b(\d{6})\b/,
  ];
  for (const re of patterns) {
    const match = normalized.match(re);
    if (match?.[1]) return match[1];
  }
  return '';
}

export function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export type MailMessage = {
  from: string;
  subject: string;
  date: string;
  message: string;
  code: string;
  folder?: string;
};

export async function fetchOutlookMessages(opts: {
  email: string;
  refreshToken: string;
  clientId: string;
  limitPerFolder?: number;
}): Promise<{ messages: MailMessage[]; tokenEndpoint: string }> {
  const { ImapFlow } = await import('imapflow');

  const { accessToken, endpoint } = await refreshHotmailAccessToken(opts.refreshToken, opts.clientId);
  const limit = opts.limitPerFolder ?? 30;
  const folders = ['INBOX', 'Junk', 'Junk Email'];

  const client = new ImapFlow({
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    auth: {
      user: opts.email,
      accessToken,
    },
    logger: false,
    emitLogs: false,
  });

  const messages: MailMessage[] = [];

  try {
    await client.connect();

    for (const folder of folders) {
      try {
        const lock = await client.getMailboxLock(folder).catch(() => null);
        if (!lock) continue;

        try {
          const status = client.mailbox;
          if (!status || !status.exists) continue;

          const start = Math.max(1, status.exists - limit + 1);
          for await (const msg of client.fetch(`${start}:*`, {
            uid: true,
            envelope: true,
            source: true,
          })) {
            const envelope = msg.envelope || ({} as any);
            const fromParts = Array.isArray(envelope.from) ? envelope.from : [];
            const from = fromParts
              .map((f: any) => [f.name, f.address ? `<${f.address}>` : ''].filter(Boolean).join(' '))
              .filter(Boolean)
              .join(', ');

            const subject = String(envelope.subject || '').trim();
            const date = envelope.date ? new Date(envelope.date).toISOString() : '';

            let bodyText = '';
            try {
              const source = msg.source ? msg.source.toString('utf8') : '';
              // Prefer text/plain; fall back to stripped HTML
              const textMatch = source.match(
                /Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\nContent-Type:|$)/i
              );
              const htmlMatch = source.match(
                /Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\nContent-Type:|$)/i
              );
              if (textMatch?.[1]) {
                bodyText = textMatch[1].replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) =>
                  String.fromCharCode(parseInt(h, 16))
                );
              } else if (htmlMatch?.[1]) {
                bodyText = htmlToText(
                  htmlMatch[1].replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) =>
                    String.fromCharCode(parseInt(h, 16))
                  )
                );
              } else {
                bodyText = htmlToText(source).slice(0, 4000);
              }
            } catch {
              bodyText = '';
            }

            const haystack = `${from}\n${subject}\n${bodyText}`;
            const code = extractOtpCode(haystack);

            messages.push({
              from,
              subject,
              date,
              message: bodyText.slice(0, 4000),
              code,
              folder,
            });
          }
        } finally {
          lock.release();
        }
      } catch {
        // folder open failed — skip
      }
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }

  // Newest first
  messages.sort((a, b) => {
    const ta = a.date ? Date.parse(a.date) : 0;
    const tb = b.date ? Date.parse(b.date) : 0;
    return tb - ta;
  });

  return { messages, tokenEndpoint: endpoint };
}

export function pickOpenAIOtp(messages: MailMessage[]): string {
  for (const msg of messages) {
    const hay = `${msg.from} ${msg.subject} ${msg.message}`.toLowerCase();
    const isOpenAI =
      hay.includes('openai') ||
      hay.includes('chatgpt') ||
      hay.includes('verification') ||
      hay.includes('verify') ||
      hay.includes('xác minh');
    if (isOpenAI && msg.code) return msg.code;
  }
  for (const msg of messages) {
    if (msg.code) return msg.code;
  }
  return '';
}
