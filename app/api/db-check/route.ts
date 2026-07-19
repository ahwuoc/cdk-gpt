import { NextResponse } from 'next/server';
import clientPromise, { getDatabase } from '@/lib/mongodb';

export async function GET() {
  try {
    const client = await clientPromise;
    const db = await getDatabase();
    
    // Perform a quick ping to test database responsiveness
    const pingResult = await db.command({ ping: 1 });

    return NextResponse.json({
      status: 'ok',
      message: 'Successfully connected to MongoDB!',
      ping: pingResult,
      dbName: db.databaseName,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Failed to connect to MongoDB',
        error: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
