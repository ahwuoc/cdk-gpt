"use client";

import React, { useState, useEffect } from "react";
import {
  Mail, RefreshCw, Key, ArrowRight, ShieldCheck,
  Clipboard, Check, HelpCircle, Users, Trash2,
  Play, CheckCircle2, XCircle, AlertTriangle, Save,
  Globe, EyeOff, Zap
} from "lucide-react";
import { getOtpPublicAction } from "../otp-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ChatGPTUsageGuidelines } from "@/components/chatgpt-usage-guidelines";

interface ParsedAccount {
  id: number;
  email: string;
  pass: string;
  refreshToken: string;
  clientId: string;
  status: "idle" | "loading" | "success" | "error";
  errorMsg?: string;
  otp?: string;
  messages?: any[];
}

export default function OtpPage() {
  const [rawInput, setRawInput] = useState("");
  const [accounts, setAccounts] = useState<ParsedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  const [isScanningAll, setIsScanningAll] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [isLoadedFromCache, setIsLoadedFromCache] = useState(false);

  useEffect(() => {
    try {
      const cachedRaw = localStorage.getItem("otp_raw_input");
      const cachedAccounts = localStorage.getItem("otp_accounts");

      if (cachedRaw) {
        setRawInput(cachedRaw);
      }

      if (cachedAccounts) {
        const parsed = JSON.parse(cachedAccounts);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAccounts(parsed);
          setSelectedAccountId(parsed[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to load OTP accounts from localStorage cache", e);
    }
    setIsLoadedFromCache(true);
  }, []);

  // Save to cache whenever raw input or parsed accounts change
  useEffect(() => {
    if (!isLoadedFromCache) return;
    try {
      localStorage.setItem("otp_raw_input", rawInput);
      localStorage.setItem("otp_accounts", JSON.stringify(accounts));
    } catch (e) {
      console.error("Failed to save OTP accounts to localStorage cache", e);
    }
  }, [rawInput, accounts, isLoadedFromCache]);

  // Handle auto-parsing when raw text is pasted or edited
  const handleTextareaChange = (val: string) => {
    setRawInput(val);
    const lines = val.split("\n");
    const parsed: ParsedAccount[] = [];
    let idCounter = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const parts = trimmed.split("|").map((p) => p.trim());
      if (parts.length >= 4 && parts[0].includes("@")) {
        parsed.push({
          id: idCounter++,
          email: parts[0],
          pass: parts[1],
          refreshToken: parts[2],
          clientId: parts[3],
          status: "idle",
        });
      }
    });

    setAccounts(parsed);
    if (parsed.length > 0) {
      setSelectedAccountId(parsed[0].id);
    } else {
      setSelectedAccountId(null);
    }
  };

  // Scan a single account
  const scanSingleAccount = async (id: number) => {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return;

    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "loading", errorMsg: undefined, otp: undefined } : a))
    );

    try {
      const result = await getOtpPublicAction(acc.email, acc.pass, acc.refreshToken, acc.clientId);
      if (result.success && result.messages) {
        const otpMsg = result.messages.find((m: any) => Boolean(m.otp));
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                ...a,
                status: "success",
                otp: otpMsg ? otpMsg.otp : "Không có OTP",
                messages: result.messages,
              }
              : a
          )
        );
      } else {
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                ...a,
                status: "error",
                errorMsg: result.message || "Tài khoản sai cấu hình hoặc bị Microsoft chặn.",
              }
              : a
          )
        );
      }
    } catch (err: any) {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
              ...a,
              status: "error",
              errorMsg: err.message || "Không thể kết nối đến máy chủ API.",
            }
            : a
        )
      );
    }
  };

  const scanAllAccounts = async () => {
    if (isScanningAll || accounts.length === 0) return;
    setIsScanningAll(true);

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      setSelectedAccountId(acc.id);
      await scanSingleAccount(acc.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    setIsScanningAll(false);
  };

  // Clear all accounts and localStorage cache
  const handleClear = () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa danh sách tài khoản đang được lưu hiện tại?")) {
      setRawInput("");
      setAccounts([]);
      setSelectedAccountId(null);
      localStorage.removeItem("otp_raw_input");
      localStorage.removeItem("otp_accounts");
    }
  };

  // Copy helpers
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 1500);
    } catch (e) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 1500);
    }
  };

  const handleCopyOtp = async (otp: string) => {
    try {
      await navigator.clipboard.writeText(otp);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = otp;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedOtp(otp);
    setTimeout(() => {
      setCopiedOtp(null);
    }, 1500);
  };

  // Statistics
  const totalAccs = accounts.length;
  const successAccs = accounts.filter((a) => a.status === "success").length;
  const errorAccs = accounts.filter((a) => a.status === "error").length;
  const loadingAccs = accounts.filter((a) => a.status === "loading").length;
  const hasOtpAccs = accounts.filter((a) => a.otp && a.otp !== "Không có OTP").length;

  // Selected account for detail view
  const currentAccount = accounts.find((a) => a.id === selectedAccountId) || null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-amber-500/30 selection:text-amber-200">
      {/* Decorative gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-blue-500/10 rounded-full blur-[150px] pointer-events-none" />

      {/* Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/40 backdrop-blur-md relative z-10">
        <div className="max-w-[1600px] w-full mx-auto px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href="/shop" className="flex items-center gap-2 group">
            <div className="w-9 h-9 bg-gradient-to-tr from-amber-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform duration-200">
              <Mail className="h-5 w-5 text-slate-950" />
            </div>
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-amber-400 to-amber-200 bg-clip-text text-transparent">
              Bulk OTP Hotmail
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/shop"
              className="text-sm font-medium text-slate-400 hover:text-slate-100 transition-colors flex items-center gap-1 group"
            >
              Cửa hàng
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 max-w-[1600px] w-full mx-auto px-6 lg:px-8 py-8 relative z-10 grid grid-cols-1 xl:grid-cols-12 gap-8">

        {/* Left Column: Input and cached list */}
        <section className="xl:col-span-7 space-y-6 flex flex-col">
          <div className="space-y-2">
            <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent sm:text-4xl">
              Hệ Thống Lấy OTP Hàng Loạt
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-slate-400 text-sm">
                Quản lý và lấy mã OTP từ danh sách tài khoản Hotmail thông qua bộ nhớ đệm (localStorage) tiện lợi.
              </p>
              <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 gap-1 text-[10px]">
                <Save className="h-3 w-3" />
                Đã kích hoạt tự động sao lưu
              </Badge>
            </div>
          </div>

          {/* Paste Area Card */}
          <Card className="border-slate-800/80 bg-slate-900/40 backdrop-blur-lg relative overflow-hidden shadow-2xl">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-blue-500" />
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-200">
                  <Users className="h-4 w-4 text-amber-500" />
                  Ném danh sách Hotmail vào đây
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 mt-1">
                  Định dạng: <span className="font-mono text-amber-400">email | pass | refresh_token | client_id</span> (Tự động lưu vào cache trình duyệt)
                </CardDescription>
              </div>
              {accounts.length > 0 && (
                <button
                  onClick={handleClear}
                  className="text-xs text-red-400 hover:text-red-300 font-semibold transition-colors flex items-center gap-1 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Xóa bộ nhớ đệm
                </button>
              )}
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="siegfrieddrusillaiphigenia2049@hotmail.com|k9A5mMW0YS|M.C543_BAY.0.U.-ClR...|9e5f94bc...&#10;adonisjaspersaffira2190@hotmail.com|n6xPChlV7n|M.C529_BAY.0.U.-ChoB...|9e5f94bc..."
                value={rawInput}
                onChange={(e) => handleTextareaChange(e.target.value)}
                className="min-h-[140px] max-h-[300px] bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-700 font-mono text-xs focus-visible:ring-amber-500 rounded-xl leading-relaxed"
              />

              {/* Stats Bar */}
              {totalAccs > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-800/60 text-xs">
                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-900 text-center">
                    <span className="text-slate-500 block mb-0.5">Tài khoản</span>
                    <span className="font-black text-slate-200 text-sm">{totalAccs}</span>
                  </div>
                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-900 text-center">
                    <span className="text-slate-500 block mb-0.5">Đang quét</span>
                    <span className="font-black text-amber-500 text-sm animate-pulse">{loadingAccs}</span>
                  </div>
                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-900 text-center">
                    <span className="text-slate-500 block mb-0.5">Thành công</span>
                    <span className="font-black text-emerald-400 text-sm">{successAccs}</span>
                  </div>
                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-900 text-center">
                    <span className="text-slate-500 block mb-0.5">Có OTP</span>
                    <span className="font-black text-sky-400 text-sm">{hasOtpAccs}</span>
                  </div>
                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-900 text-center col-span-2 sm:col-span-1">
                    <span className="text-slate-500 block mb-0.5">Thất bại</span>
                    <span className="font-black text-red-400 text-sm">{errorAccs}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Parsed cached accounts table */}
          {accounts.length > 0 && (
            <Card className="border-slate-800/80 bg-slate-900/20 backdrop-blur-lg flex-1 flex flex-col min-h-[350px] shadow-2xl">
              <CardHeader className="pb-3 border-b border-slate-800/60 bg-slate-900/40 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Save className="h-4 w-4 text-emerald-400" />
                    Danh sách đã lưu trong bộ nhớ
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 mt-0.5">
                    Click chuột vào dòng bất kỳ để xem danh sách chi tiết các thư.
                  </CardDescription>
                </div>
                <Button
                  onClick={scanAllAccounts}
                  disabled={isScanningAll || loadingAccs > 0}
                  className="bg-amber-500 text-slate-950 hover:bg-amber-400 font-black text-xs h-9 px-4 rounded-lg shadow-lg active:scale-95 transition-all shrink-0 flex items-center gap-1.5"
                >
                  <Play className="h-3.5 w-3.5 fill-slate-950" />
                  LẤY OTP TẤT CẢ ({accounts.length})
                </Button>
              </CardHeader>

              <CardContent className="p-0 overflow-y-auto flex-1 max-h-[480px]">
                <div className="divide-y divide-slate-800/60">
                  {accounts.map((acc) => {
                    const isSelected = selectedAccountId === acc.id;
                    const hasOtp = acc.otp && acc.otp !== "Không có OTP";

                    return (
                      <div
                        key={acc.id}
                        onClick={() => setSelectedAccountId(acc.id)}
                        className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-3.5 gap-3 cursor-pointer text-left transition-colors ${isSelected
                          ? "bg-amber-500/[0.04] border-l-2 border-amber-500"
                          : "hover:bg-slate-900/40 border-l-2 border-transparent"
                          }`}
                      >
                        <div className="min-w-0 flex-1 space-y-1 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-200 truncate block">
                              {acc.email}
                            </span>
                            <span className="text-[10px] font-mono text-slate-600 select-all font-semibold">
                              | {acc.pass}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {acc.status === "idle" && (
                              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                                Chưa quét OTP
                              </span>
                            )}
                            {acc.status === "loading" && (
                              <span className="text-[10px] text-amber-400 flex items-center gap-1 font-semibold">
                                <RefreshCw className="h-3 w-3 animate-spin text-amber-500" />
                                Đang quét thư...
                              </span>
                            )}
                            {acc.status === "success" && (
                              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                Quét thành công
                              </span>
                            )}
                            {acc.status === "error" && (
                              <span
                                className="text-[10px] text-red-400 flex items-center gap-1 font-semibold"
                                title={acc.errorMsg}
                              >
                                <XCircle className="h-3 w-3 text-red-400" />
                                Quét thất bại (Kiểm tra lại Token)
                              </span>
                            )}
                          </div>
                        </div>

                        {/* OTP display and individual Lấy OTP button */}
                        <div className="flex items-center gap-2 shrink-0 justify-end">
                          {acc.status === "success" && (
                            <>
                              {hasOtp ? (
                                <div className="flex items-center gap-1">
                                  <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-bold text-xs px-2.5 py-1 select-all">
                                    {acc.otp}
                                  </Badge>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCopyOtp(acc.otp || "");
                                    }}
                                    className="p-1.5 bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-lg active:scale-95 transition-all"
                                    title="Copy OTP"
                                  >
                                    {copiedOtp === acc.otp ? (
                                      <Check className="h-3.5 w-3.5 text-green-400" />
                                    ) : (
                                      <Clipboard className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <Badge variant="outline" className="text-slate-500 border-slate-800 text-[10px] py-1 px-2 font-semibold">
                                  Không có OTP
                                </Badge>
                              )}
                            </>
                          )}

                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              scanSingleAccount(acc.id);
                            }}
                            disabled={acc.status === "loading" || isScanningAll}
                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] h-8 px-3 rounded-lg active:scale-95 transition-all flex items-center gap-1 font-extrabold disabled:opacity-50"
                          >
                            <Key className="h-3 w-3 fill-slate-950" />
                            LẤY OTP
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Right Column: Detailed Messages Panel */}
        <section className="xl:col-span-5 flex flex-col">
          <Card className="border-slate-800/80 bg-slate-900/30 backdrop-blur-lg flex-1 flex flex-col rounded-2xl overflow-hidden shadow-2xl min-h-[450px]">
            <CardHeader className="border-b border-slate-800/60 bg-slate-900/60 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-bold">Chi tiết Hộp thư</CardTitle>
                  <CardDescription className="text-slate-500 text-xs">
                    {currentAccount ? `Đang xem: ${currentAccount.email}` : "Vui lòng chọn một tài khoản."}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse" />
                  <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase">Live</span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col p-6 overflow-y-auto">
              {!currentAccount ? (
                <div className="flex-1 flex flex-col items-center justify-center py-20 text-center text-slate-500">
                  <div className="w-16 h-16 bg-slate-900 border border-slate-800 rounded-3xl flex items-center justify-center mb-6">
                    <Mail className="h-8 w-8 text-slate-700" />
                  </div>
                  <h3 className="text-base font-bold text-slate-400 mb-1">Chưa chọn tài khoản</h3>
                  <p className="text-xs text-slate-600 max-w-xs mx-auto">
                    Bấm vào tài khoản bất kỳ ở danh sách đã phân tích bên trái để xem nội dung thư chi tiết tại đây.
                  </p>
                </div>
              ) : currentAccount.status === "loading" ? (
                <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
                  <div className="relative mb-6">
                    <div className="w-16 h-16 rounded-full border-t-2 border-r-2 border-amber-500 animate-spin" />
                    <Mail className="h-6 w-6 text-amber-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-200 mb-1">Đang lấy thư mới</h3>
                  <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                    Hệ thống đang truy vấn mã xác nhận OAuth2 và quét các email trong hộp thư <strong>{currentAccount.email}</strong>...
                  </p>
                </div>
              ) : currentAccount.status === "error" ? (
                <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/25 flex items-center justify-center mb-4">
                    <AlertTriangle className="h-6 w-6 text-red-400" />
                  </div>
                  <h3 className="text-base font-bold text-red-400 mb-2">Đã xảy ra lỗi</h3>
                  <div className="bg-slate-950 border border-slate-900 p-3.5 rounded-xl max-w-sm text-xs font-mono text-red-300 break-all mb-4">
                    {currentAccount.errorMsg || "Lỗi cấu hình token."}
                  </div>
                  <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                    Vui lòng kiểm tra lại sự chính xác của Mật khẩu, Refresh Token, Client ID. Đảm bảo tài khoản Hotmail của bạn đang hoạt động bình thường.
                  </p>
                </div>
              ) : !currentAccount.messages || currentAccount.messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-20 text-center text-slate-500">
                  <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mb-4">
                    <Mail className="h-6 w-6 text-slate-700" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-400 mb-1">Hộp thư rỗng</h3>
                  <p className="text-xs text-slate-600 max-w-xs mx-auto">
                    Quét thư thành công nhưng không tìm thấy email mới nào trong tài khoản này.
                  </p>
                </div>
              ) : (
                <div className="space-y-6 flex-1 flex flex-col">

                  {(() => {
                    const isDeactivated = currentAccount.messages?.some(msg =>
                      msg.subject?.toLowerCase().includes("deactivated") ||
                      msg.message?.toLowerCase().includes("deactivated")
                    );

                    if (!isDeactivated) return null;

                    const deactivatedMsg = currentAccount.messages.find(msg =>
                      msg.subject?.toLowerCase().includes("deactivated") ||
                      msg.message?.toLowerCase().includes("deactivated")
                    );

                    return (
                      <div className="rounded-2xl border border-red-500/25 bg-red-950/20 p-5 text-slate-100 shadow-xl overflow-hidden relative border-l-4 border-l-red-500 animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-full blur-2xl pointer-events-none" />
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-center shrink-0">
                            <AlertTriangle className="h-5 w-5 text-red-400 animate-pulse" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-xs font-black uppercase tracking-wider text-red-400 flex items-center gap-1.5">
                              ⚠️ CẢNH BÁO: TÀI KHOẢN ĐÃ BỊ OPENAI KHÓA (DIE ACC)
                            </h4>
                            <p className="text-[11px] text-slate-300 leading-relaxed font-semibold">
                              Phát hiện thư quét bảo mật của OpenAI gửi tới tài khoản này: <strong className="text-red-300">"Access deactivated"</strong>.
                            </p>
                            <div className="bg-slate-950/70 p-2.5 rounded border border-slate-900 text-[10px] text-slate-400 font-mono mt-1 break-all line-clamp-2">
                              {deactivatedMsg?.subject || "OpenAI - Access Deactivated"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Highlight parsed OTP code if present */}
                  {currentAccount.otp && currentAccount.otp !== "Không có OTP" && (
                    <div className="rounded-2xl border border-slate-800 bg-[#0f2333] p-5 text-slate-100 shadow-xl overflow-hidden relative">
                      <div className="absolute top-0 right-0 w-20 h-20 bg-sky-500/5 rounded-full blur-2xl pointer-events-none" />
                      <div className="space-y-3.5">
                        <div className="space-y-0.5">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-400">
                            Mã xác nhận OTP phát hiện được
                          </div>
                          <h4 className="text-sm font-bold text-white line-clamp-1">
                            {currentAccount.messages.find((m) => Boolean(m.otp))?.subject || "Mã OTP mới nhất"}
                          </h4>
                          <p className="text-[10px] text-slate-400">
                            {currentAccount.messages.find((m) => Boolean(m.otp))?.date || ""}
                          </p>
                        </div>

                        <div className="rounded-xl border border-sky-500/10 bg-[#0a1824] p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                          <div className="text-center sm:text-left">
                            <span className="text-[9px] font-bold text-sky-400/80 uppercase tracking-widest block">Verification Code</span>
                            <span className="font-mono text-3xl font-black tracking-widest text-white select-all">
                              {currentAccount.otp}
                            </span>
                          </div>
                          <Button
                            onClick={() => handleCopyOtp(currentAccount.otp || "")}
                            className="w-full sm:w-auto h-10 px-5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold active:scale-95 transition-all shrink-0"
                          >
                            <Key className="h-3.5 w-3.5 mr-1.5" />
                            {copiedOtp === currentAccount.otp ? "Đã copy!" : "SAO CHÉP MÃ"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* List of received emails */}
                  <div className="space-y-3 flex-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 px-1">
                      Thư trong hộp ({currentAccount.messages.length})
                    </span>
                    <div className="space-y-2">
                      {currentAccount.messages.map((msg, index) => (
                        <div
                          key={index}
                          className="w-full rounded-xl border border-slate-800/80 bg-slate-900/30 p-4 space-y-2 text-left"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <h4 className="text-xs font-bold text-slate-200 truncate">{msg.subject}</h4>
                              <p className="text-[10px] text-slate-500">{msg.date}</p>
                            </div>
                            {msg.otp && (
                              <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-bold text-[10px] px-2 py-0.5 shrink-0">
                                {msg.otp}
                              </Badge>
                            )}
                          </div>

                          {msg.message && (
                            <p className="text-[11px] text-slate-400 line-clamp-2 bg-slate-950/40 p-2 rounded-lg font-normal border border-slate-900">
                              {msg.message.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-900/60 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-600">
              <span>Hộp thư được xử lý an toàn thông qua API Server-to-Server.</span>
              <span className="font-mono text-[10px]">OTP-SERVICE v1.0</span>
            </div>
          </Card>
        </section>

        {/* ChatGPT Usage Guidelines spanned full-width at bottom */}
        <div className="xl:col-span-12 w-full mt-2">
          <ChatGPTUsageGuidelines />
        </div>
      </div>

      {/* Footer copyright */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-600 relative z-10 mt-auto">
        <p>© 2026 ChatGPT Reg-Tools. Developed for premium access utility.</p>
      </footer>
    </main>
  );
}
