import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { parseAccountLine } from '@/lib/models';

function checkAdminAuth(req: Request, bodySecret?: string): boolean {
  const adminSecret = process.env.ADMIN_SECRET || 'admin123';
  const headerSecret = req.headers.get('x-admin-secret');
  return headerSecret === adminSecret || bodySecret === adminSecret;
}

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '500', 10);

    const db = await getDatabase();
    const query: any = {};
    if (status) {
      query.status = status;
    }
    if (type) {
      query.type = type.toUpperCase();
    }

    const accounts = await db
      .collection('accounts')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({
      status: 'success',
      total: accounts.length,
      accounts,
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Failed to fetch accounts' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { secret, rawText, type = 'PLUS' } = body || {};

    if (!checkAdminAuth(req, secret)) {
      return NextResponse.json({ status: 'error', message: 'Mật khẩu Admin không đúng.' }, { status: 401 });
    }

    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return NextResponse.json(
        { status: 'error', message: 'Vui lòng nhập danh sách tài khoản!' },
        { status: 400 }
      );
    }

    const accountType = (type || 'PLUS').trim().toUpperCase();
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const validDocuments: any[] = [];
    let invalidCount = 0;

    const now = new Date();

    for (const line of lines) {
      const parsed = parseAccountLine(line);
      if (parsed.isValid) {
        validDocuments.push({
          raw: parsed.raw,
          email: parsed.email,
          password: parsed.password,
          token: parsed.token,
          accountId: parsed.accountId,
          type: accountType,
          status: 'available',
          usedByCdk: null,
          createdAt: now,
          usedAt: null,
        });
      } else {
        invalidCount++;
      }
    }

    if (validDocuments.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'Không tìm thấy tài khoản hợp lệ dạng email|password|token|id' },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const result = await db.collection('accounts').insertMany(validDocuments);

    return NextResponse.json({
      status: 'success',
      message: `Đã nhập thành công ${result.insertedCount} tài khoản [Gói: ${accountType}] vào kho!`,
      importedCount: result.insertedCount,
      invalidCount,
      type: accountType,
    });
  } catch (error: any) {
    console.error('Error importing accounts:', error);
    return NextResponse.json(
      { status: 'error', message: 'Lỗi máy chủ khi nhập kho: ' + (error?.message || String(error)) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { secret, action } = body || {};

    if (!checkAdminAuth(req, secret)) {
      return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDatabase();
    if (action === 'clear_all') {
      const result = await db.collection('accounts').deleteMany({});
      return NextResponse.json({
        status: 'success',
        message: `Đã dọn dẹp sạch ${result.deletedCount} tài khoản trong kho.`,
      });
    }

    return NextResponse.json({ status: 'error', message: 'Hành động không hợp lệ' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Lỗi khi xóa tài khoản' },
      { status: 500 }
    );
  }
}
