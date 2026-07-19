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
    const db = await getDatabase();

    const [
      totalAccounts,
      availableAccounts,
      usedAccounts,
      totalCdks,
      unusedCdks,
      redeemedCdks,
    ] = await Promise.all([
      db.collection('accounts').countDocuments({}),
      db.collection('accounts').countDocuments({ status: 'available' }),
      db.collection('accounts').countDocuments({ status: 'used' }),
      db.collection('cdks').countDocuments({}),
      db.collection('cdks').countDocuments({ status: 'unused' }),
      db.collection('cdks').countDocuments({ status: 'redeemed' }),
    ]);

    return NextResponse.json({
      status: 'success',
      stats: {
        totalAccounts,
        availableAccounts,
        usedAccounts,
        totalCdks,
        unusedCdks,
        redeemedCdks,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
