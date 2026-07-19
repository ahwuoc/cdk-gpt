import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { generateCdkCode } from '@/lib/models';

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

    const cdks = await db
      .collection('cdks')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({
      status: 'success',
      total: cdks.length,
      cdks,
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Failed to fetch CDKs' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { secret, count = 1, note = '', customCodesText, mode = 'generate', type = 'PLUS' } = body || {};

    if (!checkAdminAuth(req, secret)) {
      return NextResponse.json({ status: 'error', message: 'Mật khẩu Admin không đúng.' }, { status: 401 });
    }

    const cdkType = (type || 'PLUS').trim().toUpperCase();
    const db = await getDatabase();
    const cdksCollection = db.collection('cdks');

    await cdksCollection.createIndex({ code: 1 }, { unique: true }).catch(() => {});

    const now = new Date();
    const generatedDocs: any[] = [];
    const finalCodes: string[] = [];

    const existingCodesSet = new Set(
      (await cdksCollection.find({}, { projection: { code: 1 } }).toArray()).map((c) => c.code)
    );

    if (mode === 'import' && customCodesText && typeof customCodesText === 'string') {
      const rawLines = customCodesText
        .split(/[\r\n,;]+/)
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);

      const uniqueInputCodes = Array.from(new Set(rawLines));
      let duplicateCount = 0;

      for (const code of uniqueInputCodes) {
        if (existingCodesSet.has(code)) {
          duplicateCount++;
          continue;
        }
        existingCodesSet.add(code);
        finalCodes.push(code);

        generatedDocs.push({
          code,
          type: cdkType,
          status: 'unused',
          redeemedAccountId: null,
          redeemedAccountData: null,
          note: note ? note.trim() : 'Nhập thủ công',
          createdAt: now,
          redeemedAt: null,
        });
      }

      if (generatedDocs.length === 0) {
        return NextResponse.json(
          { status: 'error', message: 'Không có mã CDK hợp lệ nào (tất cả đã tồn tại trong hệ thống).' },
          { status: 400 }
        );
      }

      const result = await cdksCollection.insertMany(generatedDocs);

      return NextResponse.json({
        status: 'success',
        message: `Đã nhập thành công ${result.insertedCount} mã CDK [Gói: ${cdkType}] vào hệ thống!${
          duplicateCount > 0 ? ` (Bỏ qua ${duplicateCount} mã trùng)` : ''
        }`,
        insertedCount: result.insertedCount,
        codes: finalCodes,
        type: cdkType,
      });
    }

    // Auto-generate mode with prefix type (e.g. PLUS-XXXX-YYYY-ZZZZ)
    const numToGenerate = Math.min(Math.max(parseInt(String(count), 10) || 1, 1), 500);

    for (let i = 0; i < numToGenerate; i++) {
      let code = generateCdkCode(cdkType);
      while (existingCodesSet.has(code)) {
        code = generateCdkCode(cdkType);
      }
      existingCodesSet.add(code);
      finalCodes.push(code);

      generatedDocs.push({
        code,
        type: cdkType,
        status: 'unused',
        redeemedAccountId: null,
        redeemedAccountData: null,
        note: note ? note.trim() : null,
        createdAt: now,
        redeemedAt: null,
      });
    }

    const result = await cdksCollection.insertMany(generatedDocs);

    return NextResponse.json({
      status: 'success',
      message: `Đã sinh thành công ${result.insertedCount} mã CDK [Gói: ${cdkType}] mới!`,
      insertedCount: result.insertedCount,
      codes: finalCodes,
      type: cdkType,
    });
  } catch (error: any) {
    console.error('Error in CDK API:', error);
    return NextResponse.json(
      { status: 'error', message: 'Lỗi máy chủ khi sinh/nhập mã CDK: ' + (error?.message || String(error)) },
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
      const result = await db.collection('cdks').deleteMany({});
      return NextResponse.json({
        status: 'success',
        message: `Đã dọn dẹp sạch ${result.deletedCount} mã CDK trong kho.`,
      });
    }

    return NextResponse.json({ status: 'error', message: 'Hành động không hợp lệ' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Lỗi khi xóa mã CDK' },
      { status: 500 }
    );
  }
}
