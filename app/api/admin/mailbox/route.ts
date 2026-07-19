import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { fetchOutlookMessages, pickOpenAIOtp } from '@/lib/outlook-mail';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, token, accountId, refresh_token, client_id } = body || {};

    let targetEmail = String(email || '').trim();
    // token / refresh_token = Microsoft refresh_token
    // accountId / client_id = Microsoft OAuth client_id
    let refreshToken = String(token || refresh_token || '').trim();
    let clientId = String(accountId || client_id || '').trim();

    // Look up from DB when credentials missing
    if (targetEmail && (!refreshToken || !clientId)) {
      const db = await getDatabase();
      const acc = await db.collection('accounts').findOne({
        email: {
          $regex: new RegExp(
            `^${targetEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
            'i'
          ),
        },
      });
      if (acc) {
        refreshToken = refreshToken || acc.token || '';
        clientId = clientId || acc.accountId || '';
        targetEmail = acc.email || targetEmail;
      }
    }

    if (!targetEmail) {
      return NextResponse.json(
        { status: 'error', message: 'Thiếu email tài khoản.' },
        { status: 400 }
      );
    }
    if (!refreshToken) {
      return NextResponse.json(
        {
          status: 'error',
          message:
            'Thiếu refresh_token. Cần định dạng: email----password----client_id----refresh_token',
        },
        { status: 400 }
      );
    }
    if (!clientId) {
      return NextResponse.json(
        {
          status: 'error',
          message:
            'Thiếu client_id. Cần định dạng: email----password----client_id----refresh_token',
        },
        { status: 400 }
      );
    }

    // Direct Microsoft OAuth + IMAP (no DongVanFB)
    const { messages, tokenEndpoint } = await fetchOutlookMessages({
      email: targetEmail,
      refreshToken,
      clientId,
      limitPerFolder: 25,
    });

    const otp = pickOpenAIOtp(messages);

    return NextResponse.json({
      status: 'success',
      email: targetEmail,
      total: messages.length,
      otp: otp || null,
      tokenEndpoint,
      messages,
    });
  } catch (error: any) {
    console.error('[mailbox]', error);
    return NextResponse.json(
      {
        status: 'error',
        message: error?.message || 'Failed to fetch mailbox messages',
      },
      { status: 500 }
    );
  }
}
