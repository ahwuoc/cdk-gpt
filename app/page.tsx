'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Key,
  Copy,
  Check,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Mail,
  Layers,
  CheckCircle2,
  XCircle,
  Tag,
  Megaphone,
} from 'lucide-react';

interface RedeemedItem {
  cdkCode: string;
  cdkType?: string;
  status: 'success' | 'already_redeemed' | 'error';
  message: string;
  account: {
    raw: string;
    email: string;
    password: string;
    token: string;
    accountId: string;
    type?: string;
  } | null;
}

export default function RedeemPage() {
  const [cdkInput, setCdkInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [resultsList, setResultsList] = useState<RedeemedItem[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [otpResults, setOtpResults] = useState<Record<string, { loading: boolean; otp: string | null; error: string | null }>>({});

  const [announcement, setAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/announcement')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'success' && data.enabled && data.announcement) {
          setAnnouncement(data.announcement);
        }
      })
      .catch(() => {});
  }, []);

  const detectedCodes = cdkInput
    .split(/[\r\n,;]+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCopyAllAccounts = () => {
    const validRaws = resultsList
      .filter((r) => r.account && r.account.raw)
      .map((r) => r.account!.raw)
      .join('\n');

    if (validRaws) {
      handleCopy(validRaws, 'all_raw');
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cdkInput.trim()) {
      setError('Vui lòng nhập mã CDK của bạn!');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setResultsList([]);

    try {
      const res = await fetch('/api/cdk/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawInput: cdkInput.trim() }),
      });

      const data = await res.json();

      if (!res.ok && data.status === 'error' && (!data.results || data.results.length === 0)) {
        setError(data.message || 'Mã CDK không hợp lệ hoặc lỗi hệ thống.');
      } else {
        setSuccessMsg(data.message);
        setResultsList(data.results || []);
      }
    } catch (err: any) {
      setError('Không thể kết nối đến máy chủ. Vui lòng thử lại sau!');
    } finally {
      setLoading(false);
    }
  };

  const handleGetOtp = async (
    account: { email: string; token?: string; accountId?: string },
    idx: number
  ) => {
    const key = `otp_${idx}`;
    setOtpResults((prev) => ({ ...prev, [key]: { loading: true, otp: null, error: null } }));
    try {
      const res = await fetch('/api/admin/mailbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: account.email,
          // Pass credentials from redeem result so we don't rely only on DB lookup
          token: account.token,
          accountId: account.accountId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        // Prefer server-side OpenAI OTP pick; fallback scan messages
        let foundOtp = (data.otp || '').trim();
        if (!foundOtp) {
          const messages: any[] = data.messages || [];
          for (const msg of messages) {
            if (msg.code) {
              foundOtp = msg.code;
              break;
            }
          }
        }
        setOtpResults((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            otp: foundOtp || null,
            error: foundOtp ? null : 'NO OTP — chưa có mail mã trong hộp thư',
          },
        }));
      } else {
        setOtpResults((prev) => ({
          ...prev,
          [key]: { loading: false, otp: null, error: data.message || 'Lỗi lấy OTP' },
        }));
      }
    } catch {
      setOtpResults((prev) => ({
        ...prev,
        [key]: { loading: false, otp: null, error: 'Lỗi kết nối máy chủ' },
      }));
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#070b14] text-slate-100 flex flex-col relative overflow-x-hidden font-sans">
      {/* Background Glows */}
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-tr from-indigo-600/20 via-purple-600/10 to-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[400px] bg-gradient-to-br from-blue-600/15 to-indigo-800/10 blur-[100px] rounded-full pointer-events-none" />

      {/* Main Container — centered both axes */}
      <main className="flex-1 w-full flex flex-col items-center justify-center relative z-10 px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="w-full max-w-3xl">
        {/* Announcement Banner if present */}
        {announcement && (
          <div className="mb-6 p-4 rounded-2xl bg-indigo-950/80 border border-indigo-500/30 text-indigo-200 text-xs sm:text-sm flex items-start gap-3 shadow-xl animate-fadeIn">
            <Megaphone className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed font-medium">{announcement}</div>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-4 shadow-sm shadow-indigo-500/10">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            Cổng Đổi Kho Tài Khoản Tự Động (Gói PLUS)
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-indigo-200 mb-3">
            Nhận Tài Khoản Qua Mã CDK
          </h1>
          <p className="text-slate-400 text-sm sm:text-base max-w-lg mx-auto leading-relaxed">
            Nhập 1 hoặc <strong>nhiều mã CDK</strong> (mỗi dòng 1 mã hoặc dấu phẩy) để nhận tài khoản tức thì.
          </p>
        </div>

        {/* Form Input Container */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/50 mb-6 relative group">
          <div className="absolute -inset-[1px] bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-emerald-500/20 rounded-2xl opacity-50 group-hover:opacity-100 transition duration-500 blur-sm pointer-events-none" />

          <form onSubmit={handleRedeem} className="relative z-10 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="cdkInput" className="block text-xs font-medium text-slate-300 uppercase tracking-wider">
                  Mã kích hoạt CDK (Hỗ trợ dán nhiều mã)
                </label>
                <span className="text-xs text-indigo-400 font-semibold flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5" />
                  Đã phát hiện: {detectedCodes.length} mã
                </span>
              </div>

              <div className="relative">
                <textarea
                  id="cdkInput"
                  rows={4}
                  value={cdkInput}
                  onChange={(e) => setCdkInput(e.target.value)}
                  placeholder={`PLUS-A1B2-C3D4-E5F6\nPLUS-7890-XYZ1-2345`}
                  className="w-full p-4 bg-slate-950/80 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl text-white font-mono text-sm placeholder-slate-600 transition-all outline-none tracking-wider uppercase resize-y leading-relaxed"
                  disabled={loading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !cdkInput.trim()}
              className="w-full py-3.5 px-6 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99] text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/30 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Đang xử lý {detectedCodes.length} mã CDK...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-5 h-5" />
                  Đổi {detectedCodes.length > 1 ? `${detectedCodes.length} Mã` : 'Mã'} Lấy Tài Khoản
                </>
              )}
            </button>
          </form>

          {/* Error Alert */}
          {error && (
            <div className="mt-4 p-4 rounded-xl bg-red-950/60 border border-red-800/60 text-red-200 text-sm flex items-start gap-3 animate-fadeIn">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-300">Không thể thực hiện</p>
                <p className="mt-0.5 text-red-300/80 leading-relaxed">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Results List Showcase */}
        {resultsList.length > 0 && (
          <div className="space-y-4 animate-fadeIn">
            {/* Individual Result Items */}
            {resultsList.map((item, idx) => {
              const otpKey = `otp_${idx}`;
              const otpState = otpResults[otpKey];

              return (
              <div
                key={idx}
                className={`bg-slate-900/90 backdrop-blur-xl rounded-2xl p-5 sm:p-6 border transition-all ${
                  item.account
                    ? 'border-emerald-500/30 shadow-xl shadow-emerald-950/10'
                    : 'border-red-500/30 shadow-xl shadow-red-950/10'
                }`}
              >
                {/* Item Top Status Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80 mb-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-purple-300 px-2.5 py-1 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                      {item.cdkCode}
                    </span>

                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs font-bold flex items-center gap-1">
                      <Tag className="w-3 h-3 text-indigo-400" /> Gói: {item.account?.type || item.cdkType || 'PLUS'}
                    </span>

                    {item.status === 'success' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Thành công
                      </span>
                    )}

                    {item.status === 'already_redeemed' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Đã đổi trước đó
                      </span>
                    )}

                    {item.status === 'error' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-semibold flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Lỗi
                      </span>
                    )}
                  </div>
                </div>

                {/* Account Details if present */}
                {item.account ? (
                  <div className="space-y-3">
                    {/* Email display row with Get OTP button */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
                        <Mail className="w-5 h-5 text-indigo-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Email</div>
                          <div className="font-mono text-sm text-white truncate select-all">{item.account.email || 'N/A'}</div>
                        </div>
                        <button
                          onClick={() => handleCopy(item.account!.email, `email_${idx}`)}
                          className="text-indigo-400 hover:text-indigo-300 cursor-pointer shrink-0"
                        >
                          {copiedField === `email_${idx}` ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>

                      {/* Get OTP Button */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleGetOtp(item.account!, idx)}
                          disabled={otpState?.loading}
                          className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {otpState?.loading ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> Đang lấy OTP...</>
                          ) : (
                            <><Key className="w-4 h-4" /> Get OTP</>
                          )}
                        </button>

                        {/* OTP Result */}
                        {otpState && !otpState.loading && (
                          otpState.otp ? (
                            <button
                              onClick={() => handleCopy(otpState.otp!, `otp_copy_${idx}`)}
                              className="px-4 py-2.5 bg-emerald-500/10 border-2 border-emerald-500/50 text-emerald-300 font-mono font-extrabold text-lg rounded-xl flex items-center gap-2 cursor-pointer hover:bg-emerald-500/20 transition-all animate-pulse"
                              title="Click để copy OTP"
                            >
                              {copiedField === `otp_copy_${idx}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                              {otpState.otp}
                            </button>
                          ) : (
                            <span
                              className="max-w-[220px] px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 font-semibold text-xs rounded-xl flex items-start gap-1.5"
                              title={otpState.error || 'NO OTP'}
                            >
                              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              <span className="line-clamp-3">{otpState.error || 'NO OTP'}</span>
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-red-300 bg-red-950/40 p-3 rounded-xl border border-red-900/40">
                    {item.message}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full text-center text-xs text-slate-600 py-4 px-4 shrink-0">
        <span>CDK Auto Redeem Portal &copy; 2026. All rights reserved.</span>
        <span className="mx-2">•</span>
        <Link href="/admin" className="text-slate-500 hover:text-indigo-400 transition-colors underline">
          Trang Quản Trị Admin
        </Link>
      </footer>
    </div>
  );
}
