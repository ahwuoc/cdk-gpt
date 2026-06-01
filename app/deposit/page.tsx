import Link from "next/link";
import { ChevronLeft, CreditCard, QrCode, RefreshCw, Wallet, Download } from "lucide-react";
import { checkDepositAction, logoutAction } from "@/app/actions";
import { SubmitButton } from "@/app/submit-button";
import { getCurrentSession, requireAuth } from "@/lib/auth";
import { findAdminUserByUsername, getAdminUserBalance } from "@/lib/admin-users";
import { buildDepositCode } from "@/lib/deposit";
import { listTransactionsByUsername } from "@/lib/transactions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DepositAutoCheck } from "@/components/deposit-auto-check";
import { CopyableField, CopyableContentBox } from "@/components/deposit-copy-fields";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")}đ`;
}

function buildVietQrUrl({
  baseUrl,
  accountNumber,
  bankCode,
  description,
  accountName,
  template,
  download,
}: {
  baseUrl: string;
  accountNumber: string;
  bankCode: string;
  description: string;
  accountName: string;
  template: string;
  download: string;
}) {
  const params = new URLSearchParams({
    addInfo: description,
    accountName,
  });

  if (download === "true") {
    params.set("download", "true");
  }

  return `${baseUrl}/${bankCode}-${accountNumber}-${template}.png?${params.toString()}`;
}

export default async function DepositPage() {
  await requireAuth();
  const session = await getCurrentSession();
  if (!session) return null;

  const currentUser = await findAdminUserByUsername(session.username);
  const transactions = await listTransactionsByUsername(session.username, 30);
  const depositHistory = transactions.filter((transaction) => transaction.type === "credit").slice(0, 10);
  const currentBalance = getAdminUserBalance(currentUser);
  if (!currentUser) return null;

  const depositCode = buildDepositCode(currentUser);
  const bankName = process.env.BANK_NAME || "Cake Bank";
  const bankAccountNumber = process.env.BANK_ACCOUNT_NUMBER || "Chưa cấu hình";
  const bankAccountName = process.env.BANK_ACCOUNT_NAME || "Chưa cấu hình";
  const bankCode = process.env.BANK_QR_CODE || process.env.BANK_CODE || "546034";
  const qrBaseUrl = process.env.VIETQR_BASE_URL || "https://img.vietqr.io/image";
  const qrTemplate = process.env.VIETQR_TEMPLATE || "compact2";
  const qrDownload = process.env.VIETQR_DOWNLOAD || "false";
  const hasBankAccountNumber = Boolean(process.env.BANK_ACCOUNT_NUMBER?.trim());

  const qrUrl = buildVietQrUrl({
    baseUrl: qrBaseUrl,
    accountNumber: bankAccountNumber,
    bankCode,
    description: depositCode,
    accountName: bankAccountName,
    template: qrTemplate,
    download: qrDownload,
  });

  const qrDownloadUrl = buildVietQrUrl({
    baseUrl: qrBaseUrl,
    accountNumber: bankAccountNumber,
    bankCode,
    description: depositCode,
    accountName: bankAccountName,
    template: qrTemplate,
    download: "true",
  });

  const hasApiToken = Boolean(process.env.BANK_API_TOKEN?.trim());

  return (
    <main className="min-h-screen pb-16">
      <DepositAutoCheck />
      <section className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-8 md:px-8">
        {/* Navigation & Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-stone-200/80 pb-6">
          <div className="flex items-center gap-4">
            <Link
              href="/shop"
              className="group flex h-12 w-12 items-center justify-center rounded-full border border-stone-200 bg-white shadow-sm transition-all duration-200 hover:border-primary/30 hover:text-primary hover:-translate-x-0.5 animate-in fade-in slide-in-from-left-2 duration-300"
            >
              <ChevronLeft className="h-6 w-6 text-stone-600 transition-colors group-hover:text-primary" />
            </Link>
            <div className="animate-in fade-in slide-in-from-left-4 duration-300">
              <h1 className="text-3xl font-extrabold tracking-tight text-stone-900">Nạp tiền vào tài khoản</h1>
              <p className="text-sm text-stone-500 font-sans mt-0.5">
                Quét mã QR hoặc chuyển khoản nhanh. Cộng tiền hoàn toàn tự động.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 animate-in fade-in slide-in-from-right-4 duration-300 font-sans">
            <Link href="/my-orders" className="text-sm font-bold text-stone-600 hover:text-primary transition-colors bg-stone-100 hover:bg-stone-200/60 px-4 py-2.5 rounded-xl font-sans">
              Đơn hàng của tôi
            </Link>
            {session.role === "admin" && (
              <Link href="/admin" className="text-sm font-bold text-stone-600 hover:text-primary transition-colors bg-stone-100 hover:bg-stone-200/60 px-4 py-2.5 rounded-xl font-sans">
                Quản trị viên
              </Link>
            )}
            <form action={logoutAction} className="inline-block">
              <SubmitButton variant="outline" className="h-10 rounded-xl border-stone-200 px-4 text-sm text-stone-500 hover:text-stone-800 transition-colors font-medium">
                Đăng xuất
              </SubmitButton>
            </form>
          </div>
        </div>

        {/* Content Layout */}
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_450px] 2xl:grid-cols-[minmax(0,1fr)_470px] animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* LEFT COLUMN: Unified Bank & QR Details */}
          <Card className="border-stone-200/80 bg-white/95 shadow-md rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-lg">
            <CardHeader className="border-b border-stone-100 pb-5 p-6 md:p-8">
              <div className="flex items-center gap-2.5">
                <CreditCard className="h-6 w-6 text-primary" />
                <CardTitle className="text-xl md:text-2xl font-black text-stone-900">Phương thức chuyển khoản</CardTitle>
              </div>
              <CardDescription className="text-xs md:text-sm text-stone-500 font-sans mt-1">
                Hỗ trợ tất cả ngân hàng Việt Nam qua chuyển khoản nhanh 24/7.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-5 md:p-7 md:pt-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)]">

                {/* QR Section */}
                <div className="flex w-full flex-col items-center justify-center gap-4 rounded-3xl border border-stone-100 bg-stone-50/50 p-4 shadow-inner md:p-5">
                  <div className="relative flex aspect-square w-full max-w-[260px] items-center justify-center rounded-2xl border border-stone-200/60 bg-white p-3 shadow-md">
                    {hasBankAccountNumber ? (
                      <img
                        src={qrUrl}
                        alt="Mã QR nạp tiền"
                        className="aspect-square w-full rounded-xl object-contain transition-transform duration-300 hover:scale-105"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center p-4 text-center text-xs font-semibold text-stone-400 font-sans">
                        Cấu hình BANK_ACCOUNT_NUMBER để hiển thị QR VietQR.
                      </div>
                    )}
                  </div>

                  {hasBankAccountNumber && (
                    <a
                      href={qrDownloadUrl}
                      download="VietQR_Deposit.png"
                      className="mt-1 flex items-center justify-center gap-2 text-sm font-bold text-primary hover:text-primary/80 transition-all duration-200 bg-stone-100 hover:bg-stone-200/80 px-4 py-2.5 rounded-xl w-full font-sans shadow-sm hover:scale-[1.02] active:scale-95 cursor-pointer"
                    >
                      <Download className="h-4 w-4" />
                      Tải ảnh QR
                    </a>
                  )}

                  <span className="text-xs font-semibold text-stone-500 text-center font-sans mt-0.5">
                    Nạp tối thiểu: <strong className="text-stone-850">{formatPrice(10000)}</strong>
                  </span>
                </div>

                {/* Details Section */}
                <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                  <CopyableField label="Ngân hàng" value={bankName} />
                  <CopyableField
                    label="Số tài khoản"
                    value={bankAccountNumber}
                    isMonospace={true}
                  />
                  <CopyableField label="Chủ tài khoản" value={bankAccountName} className="lg:col-span-2" />
                  <div className="lg:col-span-2">
                  <CopyableContentBox depositCode={depositCode} />
                  </div>
                </div>

              </div>
            </CardContent>
          </Card>

          {/* RIGHT COLUMN: Account info, check button, deposit history */}
          <div className="flex flex-col gap-6">

            {/* Wallet & Balance card */}
            <Card className="border-0 bg-gradient-to-br from-stone-900 via-stone-800 to-stone-950 text-white shadow-xl rounded-2xl overflow-hidden relative transition-all duration-300 hover:shadow-2xl">
              {/* Decorative graphic glow elements */}
              <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-primary/20 blur-2xl pointer-events-none animate-pulse" />
              <div className="absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-emerald-500/10 blur-xl pointer-events-none" />

              <CardContent className="relative z-10 flex min-h-[190px] flex-col justify-between p-6 md:p-7">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-5.5 w-5.5 text-amber-400" />
                    <span className="text-xs md:text-sm font-bold text-stone-300 font-sans tracking-widest uppercase">Ví của tôi</span>
                  </div>
                  <span className="text-xs font-bold bg-white/10 hover:bg-white/15 transition-colors px-3 py-1.5 rounded-full text-stone-200 border border-white/5 font-sans">
                    {session.username}
                  </span>
                </div>

                <div className="mt-8">
                  <span className="text-xs font-bold uppercase tracking-widest text-stone-400 block font-sans">Số dư hiện tại</span>
                  <div className="text-4xl md:text-5xl font-black text-amber-200 tracking-tight mt-2">
                    {formatPrice(currentBalance)}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-2">
                  {!hasApiToken && (
                    <Badge className="bg-red-500/10 hover:bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-sans px-3 py-1 font-semibold rounded-lg">
                      Chưa cấu hình API Token
                    </Badge>
                  )}
                  {!hasBankAccountNumber && (
                    <Badge className="bg-red-500/10 hover:bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-sans px-3 py-1 font-semibold rounded-lg">
                      Chưa cấu hình Số TK
                    </Badge>
                  )}
                  {hasApiToken && hasBankAccountNumber && (
                    <Badge className="bg-emerald-500/10 hover:bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-sans px-3 py-1 font-semibold rounded-lg animate-pulse">
                      Kênh nạp tự động hoạt động
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Check Deposit Form */}
            <form action={checkDepositAction} className="w-full">
              <SubmitButton className="h-14 w-full rounded-2xl bg-primary text-primary-foreground font-extrabold text-base md:text-lg hover:bg-primary/95 shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2.5 hover:scale-[1.01] active:scale-[0.99] font-sans cursor-pointer">
                <RefreshCw className="h-5 w-5" />
                Kiểm tra giao dịch ngay
              </SubmitButton>
            </form>

            {/* History card */}
            <Card className="border-stone-200/80 bg-white/95 shadow-md rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-lg">
              <CardHeader className="border-b border-stone-100 pb-4 p-5 md:p-6">
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="h-5 w-5 text-stone-500" />
                  <CardTitle className="text-base md:text-lg font-bold text-stone-850">Lịch sử nạp tiền</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-5 md:p-6 pt-4">
                {depositHistory.length > 0 ? (
                  <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1 font-sans scrollbar-thin">
                    {depositHistory.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between py-3 px-3.5 border border-stone-100/60 rounded-2xl bg-stone-50/20 hover:bg-stone-50/80 transition-all duration-200 hover:-translate-y-0.5 shadow-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 text-sm font-extrabold shadow-inner">
                            +
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-stone-600">{transaction.createdAt}</p>
                            <p className="text-xs text-stone-400 truncate mt-1 max-w-[180px] font-mono" title={transaction.note}>
                              {transaction.note}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm md:text-base font-black text-emerald-700">+{formatPrice(transaction.amount)}</p>
                          <p className="text-[10px] md:text-xs text-stone-400 mt-1 font-medium">Sau: {formatPrice(transaction.balanceAfter)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center text-sm font-semibold text-stone-400 font-sans">
                    Chưa có giao dịch nạp tiền nào gần đây.
                  </div>
                )}
              </CardContent>
            </Card>

          </div>

        </div>
      </section>
    </main>
  );
}
