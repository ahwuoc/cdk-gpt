import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

function checkAdminAuth(req: Request): boolean {
  const adminSecret = process.env.ADMIN_SECRET || 'admin123';
  const headerSecret = req.headers.get('x-admin-secret');
  const urlSecret = new URL(req.url).searchParams.get('secret');
  return headerSecret === adminSecret || urlSecret === adminSecret;
}

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '200', 10);
    const queryStr = searchParams.get('q') || '';

    const db = await getDatabase();
    const filter: any = { status: 'redeemed' };

    if (queryStr) {
      filter.$or = [
        { code: { $regex: queryStr, $options: 'i' } },
        { redeemedAccountData: { $regex: queryStr, $options: 'i' } },
        { note: { $regex: queryStr, $options: 'i' } },
      ];
    }

    const history = await db
      .collection('cdks')
      .find(filter)
      .sort({ redeemedAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({
      status: 'success',
      total: history.length,
      history,
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Failed to fetch redemption history' },
      { status: 500 }
    );
  }
}
