"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Key,
  Mail,
  Play,
  RefreshCw,
  Save,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { getOtpPublicAction } from "../otp-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface ParsedMessage {
  subject?: string;
  message?: string;
  date?: string;
  otp?: string;
}

interface ParsedAccount {
  id: number;
  email: string;
  pass: string;
  refreshToken: string;
  clientId: string;
  status: "idle" | "loading" | "success" | "error";
  errorMsg?: string;
  otp?: string;
  messages?: ParsedMessage[];
}

const NO_OTP_LABEL = "Không có OTP";

function isOpenAIDeactivatedMessage(message: ParsedMessage) {
  const subject = message.subject?.toLowerCase() || "";
  const body = message.message?.toLowerCase() || "";
  const isDeactivated = subject.includes("deactivated") || body.includes("deactivated");
  const isOpenAI = subject.includes("openai") || body.includes("openai") || body.includes("chatgpt") || subject.includes("chatgpt");

  return isDeactivated && isOpenAI;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

export default function OtpPage() {
  const [rawInput, setRawInput] = useState("");
  const [accounts, setAccounts] = useState<ParsedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [isScanningAll, setIsScanningAll] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState<string | null>(null);
  const [isLoadedFromCache, setIsLoadedFromCache] = useState(false);
  const [expandedMsgs, setExpandedMsgs] = useState<Record<string, boolean>>({});

  const toggleMessageExpand = (msgKey: string) => {
    setExpandedMsgs((prev) => ({
      ...prev,
      [msgKey]: !prev[msgKey],
    }));
  };

  const formatEmailBody = (html: string) => {
    if (!html) return "";

    let text = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<[^>]*>/g, "");

    text = text
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return text.replace(/\n{3,}/g, "\n\n").trim();
  };

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

  useEffect(() => {
    if (!isLoadedFromCache) return;

    try {
      localStorage.setItem("otp_raw_input", rawInput);
      localStorage.setItem("otp_accounts", JSON.stringify(accounts));
    } catch (e) {
      console.error("Failed to save OTP accounts to localStorage cache", e);
    }
  }, [rawInput, accounts, isLoadedFromCache]);

  const handleTextareaChange = (val: string) => {
    setRawInput(val);
    setExpandedMsgs({});

    const lines = val.split("\n");
    const parsed: ParsedAccount[] = [];
    let idCounter = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const parts = trimmed.split("|").map((part) => part.trim());
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
    setSelectedAccountId(parsed.length > 0 ? parsed[0].id : null);
  };

  const scanSingleAccount = async (id: number) => {
    const acc = accounts.find((account) => account.id === id);
    if (!acc) return;

    setAccounts((prev) =>
      prev.map((account) =>
        account.id === id
          ? {
            ...account,
            status: "loading",
            errorMsg: undefined,
            otp: undefined,
          }
          : account,
      ),
    );

    try {
      const result = await getOtpPublicAction(acc.email, acc.pass, acc.refreshToken, acc.clientId);

      if (result.success && result.messages) {
        const otpMsg = result.messages.find((message: ParsedMessage) => Boolean(message.otp));

        setAccounts((prev) =>
          prev.map((account) =>
            account.id === id
              ? {
                ...account,
                status: "success",
                otp: otpMsg ? otpMsg.otp : NO_OTP_LABEL,
                messages: result.messages,
              }
              : account,
          ),
        );
      } else {
        setAccounts((prev) =>
          prev.map((account) =>
            account.id === id
              ? {
                ...account,
                status: "error",
                errorMsg: result.message || "Tài khoản sai cấu hình hoặc bị Microsoft chặn.",
              }
              : account,
          ),
        );
      }
    } catch (err: any) {
      setAccounts((prev) =>
        prev.map((account) =>
          account.id === id
            ? {
              ...account,
              status: "error",
              errorMsg: err.message || "Không thể kết nối đến máy chủ API.",
            }
            : account,
        ),
      );
    }
  };

  const scanAllAccounts = async () => {
    if (isScanningAll || accounts.length === 0) return;

    setIsScanningAll(true);

    for (const account of accounts) {
      setSelectedAccountId(account.id);
      await scanSingleAccount(account.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    setIsScanningAll(false);
  };

  const handleClear = () => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa danh sách tài khoản đang được lưu hiện tại?")) {
      return;
    }

    setRawInput("");
    setAccounts([]);
    setSelectedAccountId(null);
    setCopiedOtp(null);
    setExpandedMsgs({});
    localStorage.removeItem("otp_raw_input");
    localStorage.removeItem("otp_accounts");
  };

  const handleCopyOtp = async (otp: string) => {
    await copyToClipboard(otp);
    setCopiedOtp(otp);
    setTimeout(() => {
      setCopiedOtp(null);
    }, 1500);
  };

  const totalAccs = accounts.length;
  const successAccs = accounts.filter((account) => account.status === "success").length;
  const errorAccs = accounts.filter((account) => account.status === "error").length;
  const loadingAccs = accounts.filter((account) => account.status === "loading").length;
  const hasOtpAccs = accounts.filter((account) => account.otp && account.otp !== NO_OTP_LABEL).length;
  const currentAccount = accounts.find((account) => account.id === selectedAccountId) || null;
  const latestOtpMessage = currentAccount?.messages?.find((message) => Boolean(message.otp));
  const deactivatedMessage = currentAccount?.messages?.find(isOpenAIDeactivatedMessage);

  const stats = [
    { label: "Tài khoản", value: totalAccs, className: "text-stone-900" },
    { label: "Đang quét", value: loadingAccs, className: "text-amber-700" },
    { label: "Thành công", value: successAccs, className: "text-emerald-700" },
    { label: "Có OTP", value: hasOtpAccs, className: "text-sky-700" },
    { label: "Thất bại", value: errorAccs, className: "text-red-700" },
  ];

  return (
    <main className="min-h-screen text-stone-900 selection:bg-amber-200 selection:text-stone-900">
      <header className="border-b border-stone-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/shop" className="flex items-center gap-3 text-stone-900 transition-opacity hover:opacity-80">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100">
              <Mail className="h-4 w-4 text-stone-700" />
            </div>
            <div>
              <div className="text-sm font-semibold">Bulk OTP Hotmail</div>
              <div className="text-xs text-stone-500">Giao diện rút gọn</div>
            </div>
          </Link>

          <Link
            href="/shop"
            className="inline-flex items-center gap-1 text-sm text-stone-600 transition-colors hover:text-stone-900"
          >
            Cửa hàng
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Lấy OTP Hotmail hàng loạt
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-stone-600">
                Dán danh sách tài khoản theo đúng định dạng, hệ thống sẽ tự lưu vào trình duyệt và cho phép quét từng tài khoản hoặc quét toàn bộ.
              </p>
            </div>

            <Badge variant="warning" className="w-fit gap-1">
              <Save className="h-3 w-3" />
              Tự động lưu localStorage
            </Badge>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white/70 px-5 py-4 text-sm text-stone-700 shadow-sm">
            <p className="text-sm font-semibold text-stone-900">Định dạng nhập liệu</p>
            <p className="mt-1 font-mono text-sm text-stone-600">
              email | pass | refresh_token | client_id
            </p>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-5 text-sm text-amber-900 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-semibold">Lưu ý vận hành thực chiến</p>
                <ul className="mt-2 list-disc space-y-2 pl-4 text-[13px] leading-6 text-amber-900/90">
                  <li>
                    <strong>Tuyệt đối không vã Codex/API vội:</strong> Tài khoản mới hoặc vừa đổi trạng thái đăng nhập thường cực kỳ nhạy cảm. Không nên mang đi bào API, spam prompt hoặc dùng tool cào/quét tần suất lớn ngay lập tức kẻo acc bị quét khóa hàng loạt.
                  </li>
                  <li>
                    <strong>Ngâm mỗi tài khoản 1 profile riêng:</strong> Để duy trì độ trust lâu dài, hãy nuôi/ngâm mỗi acc trên một profile trình duyệt sạch (hoặc trình duyệt chống vân tay) độc lập. Tuyệt đối tránh đăng nhập chồng chéo nhiều acc trên cùng một profile/thiết bị trong thời gian ngắn.
                  </li>
                  <li>
                    <strong>Chat chắt hạn (tương tác chừng mực):</strong> Ở giai đoạn đầu (warm-up), hãy thao tác thủ công, tương tác nhẹ nhàng và tránh các hoạt động chat dồn dập, liên tục để hệ thống ghi nhận hành vi tự nhiên.
                  </li>
                  <li>
                    <strong>Hạn chế thay đổi đột ngột:</strong> Việc đổi liên tục IP (tránh dùng public VPN/proxy bẩn bị blacklist), thiết bị hoặc thông tin đăng nhập trong thời gian ngắn sẽ làm trạng thái trust kém ổn định và dễ bị checkpoint.
                  </li>
                  <li>
                    <strong>Phạm vi của công cụ:</strong> Trang này chỉ hỗ trợ tự động đọc OTP từ hòm thư Hotmail liên kết, hoàn toàn không can thiệp hay bảo đảm được cơ chế trust, checkpoint hoặc chính sách kiểm tra của bên thứ ba (OpenAI, Microsoft, v.v.).
                  </li>
                  <li>
                    <strong>Phát hiện cảnh báo khóa:</strong> Nếu hộp thư có email liên quan đến <code>deactivated</code>, <code>OpenAI</code> hoặc <code>ChatGPT</code>, hệ thống sẽ tự động hiển thị cảnh báo đỏ trực tiếp trong khung chi tiết.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section className="space-y-6">
            <Card className="border-stone-200 bg-white/90 shadow-sm">
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base text-stone-900">
                    <Users className="h-4 w-4 text-stone-500" />
                    Danh sách tài khoản
                  </CardTitle>
                  <CardDescription className="text-sm text-stone-500">
                    Dán mỗi tài khoản trên một dòng. Hệ thống sẽ tự phân tích và lưu lại trong trình duyệt.
                  </CardDescription>
                </div>

                {accounts.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="inline-flex items-center gap-1 text-sm font-medium text-red-600 transition-colors hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                    Xóa bộ nhớ đệm
                  </button>
                )}
              </CardHeader>

              <CardContent>
                <Textarea
                  placeholder="email@hotmail.com|matkhau|refresh_token|client_id"
                  value={rawInput}
                  onChange={(e) => handleTextareaChange(e.target.value)}
                  className="min-h-[180px] max-h-[320px] rounded-lg border-stone-200 bg-stone-50 text-sm leading-6 text-stone-900 placeholder:text-stone-400 focus-visible:ring-amber-500"
                />

                {totalAccs > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-stone-200 pt-4 sm:grid-cols-5">
                    {stats.map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-3"
                      >
                        <div className="text-[11px] uppercase tracking-wide text-stone-500">
                          {stat.label}
                        </div>
                        <div className={`mt-1 text-lg font-semibold ${stat.className}`}>{stat.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {accounts.length > 0 && (
              <Card className="border-stone-200 bg-white/90 shadow-sm">
                <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base text-stone-900">Danh sách đã phân tích</CardTitle>
                    <CardDescription className="text-sm text-stone-500">
                      Chọn một tài khoản để xem hộp thư chi tiết ở cột bên phải.
                    </CardDescription>
                  </div>

                  <Button
                    onClick={scanAllAccounts}
                    disabled={isScanningAll || loadingAccs > 0}
                    className="bg-stone-900 text-white hover:bg-stone-800"
                  >
                    <Play className="h-4 w-4" />
                    Quét tất cả ({accounts.length})
                  </Button>
                </CardHeader>

                <CardContent className="max-h-[520px] overflow-y-auto p-0">
                  <div className="divide-y divide-stone-200">
                    {accounts.map((acc) => {
                      const isSelected = selectedAccountId === acc.id;
                      const hasOtp = acc.otp && acc.otp !== NO_OTP_LABEL;

                      return (
                        <div
                          key={acc.id}
                          onClick={() => setSelectedAccountId(acc.id)}
                          className={`cursor-pointer border-l-4 px-4 py-4 transition-colors ${isSelected
                              ? "border-l-amber-500 bg-amber-50/80"
                              : "border-l-transparent hover:bg-stone-50"
                            }`}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-medium text-stone-900">
                                  {acc.email}
                                </span>
                                <span className="rounded-md bg-stone-100 px-2 py-1 text-[11px] font-mono text-stone-500">
                                  {acc.pass}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                {acc.status === "idle" && (
                                  <Badge variant="outline" className="border-stone-200 bg-white text-stone-600">
                                    Chưa quét
                                  </Badge>
                                )}

                                {acc.status === "loading" && (
                                  <Badge variant="warning" className="gap-1">
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    Đang quét
                                  </Badge>
                                )}

                                {acc.status === "success" && (
                                  <Badge variant="success" className="gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Quét thành công
                                  </Badge>
                                )}

                                {acc.status === "error" && (
                                  <Badge variant="destructive" className="gap-1" title={acc.errorMsg}>
                                    <XCircle className="h-3 w-3" />
                                    Quét thất bại
                                  </Badge>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                              {acc.status === "success" && (
                                <>
                                  {hasOtp ? (
                                    <div className="flex items-center gap-2">
                                      <Badge variant="success" className="font-mono">
                                        {acc.otp}
                                      </Badge>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCopyOtp(acc.otp || "");
                                        }}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900"
                                        title="Copy OTP"
                                      >
                                        {copiedOtp === acc.otp ? (
                                          <Check className="h-4 w-4 text-emerald-700" />
                                        ) : (
                                          <Clipboard className="h-4 w-4" />
                                        )}
                                      </button>
                                    </div>
                                  ) : (
                                    <Badge variant="outline" className="border-stone-200 bg-white text-stone-500">
                                      {NO_OTP_LABEL}
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
                                variant="outline"
                                className="border-stone-300 bg-white text-stone-900 hover:bg-stone-50"
                              >
                                <Key className="h-4 w-4" />
                                Lấy OTP
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </section>

          <section className="flex flex-col">
            <Card className="flex min-h-[520px] flex-1 flex-col border-stone-200 bg-white/90 shadow-sm">
              <CardHeader className="border-b border-stone-200">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base text-stone-900">Chi tiết hộp thư</CardTitle>
                    <CardDescription className="text-sm text-stone-500">
                      {currentAccount ? currentAccount.email : "Chọn một tài khoản để xem chi tiết."}
                    </CardDescription>
                  </div>

                  <Badge variant="outline" className="w-fit border-stone-200 bg-stone-50 text-stone-600">
                    {currentAccount ? "Inbox" : "Chưa chọn"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex-1 p-6">
                {!currentAccount ? (
                  <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-100">
                      <Mail className="h-6 w-6 text-stone-500" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-base font-medium text-stone-900">Chưa chọn tài khoản</h3>
                      <p className="max-w-sm text-sm text-stone-500">
                        Chọn một dòng bên trái để xem thư, OTP và trạng thái quét của tài khoản đó.
                      </p>
                    </div>
                  </div>
                ) : currentAccount.status === "loading" ? (
                  <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-center">
                    <RefreshCw className="h-8 w-8 animate-spin text-amber-700" />
                    <div className="space-y-1">
                      <h3 className="text-base font-medium text-stone-900">Đang quét hộp thư</h3>
                      <p className="max-w-sm text-sm text-stone-500">
                        Hệ thống đang lấy mail mới từ tài khoản <strong>{currentAccount.email}</strong>.
                      </p>
                    </div>
                  </div>
                ) : currentAccount.status === "error" ? (
                  <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
                      <AlertTriangle className="h-6 w-6 text-red-600" />
                    </div>
                    <div className="max-w-md space-y-2">
                      <h3 className="text-base font-medium text-red-700">Quét thất bại</h3>
                      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700">
                        {currentAccount.errorMsg || "Lỗi cấu hình token."}
                      </div>
                      <p className="text-sm text-stone-500">
                        Kiểm tra lại mật khẩu, refresh token, client ID và trạng thái hoạt động của tài khoản Hotmail.
                      </p>
                    </div>
                  </div>
                ) : !currentAccount.messages || currentAccount.messages.length === 0 ? (
                  <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-100">
                      <Mail className="h-6 w-6 text-stone-500" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-base font-medium text-stone-900">Hộp thư rỗng</h3>
                      <p className="max-w-sm text-sm text-stone-500">
                        Quét thành công nhưng chưa có email nào phù hợp trong tài khoản này.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col gap-4">
                    {deactivatedMessage && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-red-700">
                              Phát hiện thư cảnh báo khóa tài khoản
                            </div>
                            <p className="text-sm text-red-700/90">
                              Có email liên quan đến OpenAI/ChatGPT với nội dung deactivated.
                            </p>
                            <p className="text-xs text-red-600">
                              {deactivatedMessage.subject || "OpenAI - Access Deactivated"}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {currentAccount.otp && currentAccount.otp !== NO_OTP_LABEL && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1">
                            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                              OTP mới nhất
                            </div>
                            <div className="font-mono text-3xl font-semibold text-emerald-900">
                              {currentAccount.otp}
                            </div>
                            {latestOtpMessage && (
                              <div className="text-sm text-emerald-800/80">
                                {latestOtpMessage.subject}
                                {latestOtpMessage.date ? ` • ${latestOtpMessage.date}` : ""}
                              </div>
                            )}
                          </div>

                          <Button
                            onClick={() => handleCopyOtp(currentAccount.otp || "")}
                            className="bg-stone-900 text-white hover:bg-stone-800"
                          >
                            <Key className="h-4 w-4" />
                            {copiedOtp === currentAccount.otp ? "Đã copy" : "Sao chép mã"}
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-stone-900">
                          Thư trong hộp ({currentAccount.messages.length})
                        </div>
                      </div>

                      <div className="space-y-3">
                        {currentAccount.messages.map((msg, index) => {
                          const msgKey = `${currentAccount.id}-${index}`;
                          const isExpanded = Boolean(expandedMsgs[msgKey]);
                          const plainText = formatEmailBody(msg.message || "");
                          const previewText = plainText.replace(/\s+/g, " ").trim();

                          return (
                            <div
                              key={index}
                              className="rounded-xl border border-stone-200 bg-stone-50/80 px-4 py-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1">
                                  <h4 className="break-words text-sm font-medium text-stone-900">
                                    {msg.subject || "Không có tiêu đề"}
                                  </h4>
                                  <p className="text-xs text-stone-500">{msg.date || "Không rõ thời gian"}</p>
                                </div>

                                {msg.otp && (
                                  <Badge variant="success" className="shrink-0 font-mono">
                                    {msg.otp}
                                  </Badge>
                                )}
                              </div>

                              {msg.message && (
                                <div className="mt-3 space-y-2">
                                  <div
                                    className={`rounded-lg border border-stone-200 bg-white px-3 py-3 text-sm leading-6 text-stone-600 ${isExpanded ? "max-h-[320px] overflow-y-auto whitespace-pre-wrap" : "line-clamp-3"
                                      }`}
                                  >
                                    {isExpanded ? plainText : previewText}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => toggleMessageExpand(msgKey)}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 transition-colors hover:text-stone-900"
                                  >
                                    {isExpanded ? (
                                      <>
                                        Thu gọn
                                        <ChevronUp className="h-3.5 w-3.5" />
                                      </>
                                    ) : (
                                      <>
                                        Xem thêm
                                        <ChevronDown className="h-3.5 w-3.5" />
                                      </>
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>

              <div className="flex items-center justify-between border-t border-stone-200 bg-stone-50/80 px-6 py-4 text-xs text-stone-500">
                <span>Hộp thư được xử lý qua API server-to-server.</span>
                <span className="font-mono">OTP-SERVICE v1.0</span>
              </div>
            </Card>
          </section>
        </div>
      </div>

      <footer className="border-t border-stone-200/80 py-6 text-center text-xs text-stone-500">
        <p>© 2026 ChatGPT Reg-Tools. Developed for premium access utility.</p>
      </footer>
    </main>
  );
}
