import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { parseAccountLine } from '@/lib/models';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { cdkCode, cdkCodes, rawInput } = body || {};

    let codesToProcess: string[] = [];

    if (Array.isArray(cdkCodes) && cdkCodes.length > 0) {
      codesToProcess = cdkCodes.map((c) => String(c).trim()).filter(Boolean);
    } else if (rawInput && typeof rawInput === 'string') {
      codesToProcess = rawInput
        .split(/[\r\n,;]+/)
        .map((c) => c.trim())
        .filter(Boolean);
    } else if (cdkCode && typeof cdkCode === 'string') {
      codesToProcess = cdkCode
        .split(/[\r\n,;]+/)
        .map((c) => c.trim())
        .filter(Boolean);
    }

    if (codesToProcess.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'Vui lòng nhập ít nhất 1 mã CDK hợp lệ.' },
        { status: 400 }
      );
    }

    const uniqueCodes = Array.from(new Set(codesToProcess.map((c) => c.toUpperCase())));

    const db = await getDatabase();
    const cdksCollection = db.collection('cdks');
    const accountsCollection = db.collection('accounts');

    const results: any[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const code of uniqueCodes) {
      const cdk = await cdksCollection.findOne({ code });

      if (!cdk) {
        errorCount++;
        results.push({
          cdkCode: code,
          status: 'error',
          message: 'Mã CDK không tồn tại hoặc không chính xác.',
          account: null,
        });
        continue;
      }

      const cdkType = (cdk.type || 'PLUS').toUpperCase();

      if (cdk.status === 'redeemed') {
        if (cdk.redeemedAccountData) {
          const parsed = parseAccountLine(cdk.redeemedAccountData);
          results.push({
            cdkCode: code,
            cdkType,
            status: 'already_redeemed',
            message: `Mã CDK [Gói: ${cdkType}] này đã được đổi trước đó.`,
            redeemedAt: cdk.redeemedAt,
            account: {
              raw: cdk.redeemedAccountData,
              email: parsed.email,
              password: parsed.password,
              token: parsed.token,
              accountId: parsed.accountId,
              type: cdkType,
            },
          });
          successCount++;
        } else {
          errorCount++;
          results.push({
            cdkCode: code,
            cdkType,
            status: 'error',
            message: 'Mã CDK này đã được sử dụng.',
            account: null,
          });
        }
        continue;
      }

      // Try picking available account matching cdkType first, fallback to any available
      let accountResult = await accountsCollection.findOneAndUpdate(
        { status: 'available', type: cdkType },
        {
          $set: {
            status: 'used',
            usedByCdk: code,
            usedAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      );

      if (!accountResult) {
        // Fallback for legacy accounts missing type
        accountResult = await accountsCollection.findOneAndUpdate(
          { status: 'available' },
          {
            $set: {
              status: 'used',
              usedByCdk: code,
              usedAt: new Date(),
            },
          },
          { returnDocument: 'after' }
        );
      }

      if (!accountResult) {
        errorCount++;
        results.push({
          cdkCode: code,
          cdkType,
          status: 'error',
          message: `Kho hiện tại đã hết tài khoản [Gói: ${cdkType}] khả dụng!`,
          account: null,
        });
        continue;
      }

      const accountData = accountResult.raw;
      const parsedAccount = parseAccountLine(accountData);

      // Update CDK status to redeemed
      await cdksCollection.updateOne(
        { _id: cdk._id },
        {
          $set: {
            status: 'redeemed',
            redeemedAccountId: accountResult._id,
            redeemedAccountData: accountData,
            redeemedAt: new Date(),
          },
        }
      );

      successCount++;
      results.push({
        cdkCode: code,
        cdkType,
        status: 'success',
        message: `Đổi mã thành công [Gói: ${cdkType}]!`,
        account: {
          raw: accountData,
          email: parsedAccount.email,
          password: parsedAccount.password,
          token: parsedAccount.token,
          accountId: parsedAccount.accountId,
          type: accountResult.type || cdkType,
        },
      });
    }

    const singleAccount = results.length === 1 && results[0].account ? results[0].account : null;

    return NextResponse.json({
      status: successCount > 0 ? 'success' : 'error',
      message: `Đã xử lý xong ${uniqueCodes.length} mã CDK (${successCount} thành công, ${errorCount} lỗi).`,
      summary: {
        totalProcessed: uniqueCodes.length,
        successCount,
        errorCount,
      },
      results,
      cdkCode: uniqueCodes[0],
      account: singleAccount,
    });
  } catch (error: any) {
    console.error('Error redeeming CDK batch:', error);
    return NextResponse.json(
      { status: 'error', message: 'Lỗi máy chủ khi đổi mã CDK: ' + (error?.message || String(error)) },
      { status: 500 }
    );
  }
}
