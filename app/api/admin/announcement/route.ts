import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

function checkAdminAuth(req: Request, bodySecret?: string): boolean {
  const adminSecret = process.env.ADMIN_SECRET || 'admin123';
  const headerSecret = req.headers.get('x-admin-secret');
  return headerSecret === adminSecret || bodySecret === adminSecret;
}

export async function GET() {
  try {
    const db = await getDatabase();
    const setting = await db.collection('settings').findOne({ key: 'announcement' });

    return NextResponse.json({
      status: 'success',
      announcement: setting?.value || '',
      enabled: setting?.enabled ?? true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Failed to fetch announcement' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { secret, announcement, enabled } = body || {};

    if (!checkAdminAuth(req, secret)) {
      return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDatabase();
    await db.collection('settings').updateOne(
      { key: 'announcement' },
      {
        $set: {
          key: 'announcement',
          value: typeof announcement === 'string' ? announcement.trim() : '',
          enabled: Boolean(enabled),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      status: 'success',
      message: 'Cập nhật thông báo tin nhắn ngoài trang chủ thành công!',
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Failed to update announcement' },
      { status: 500 }
    );
  }
}
