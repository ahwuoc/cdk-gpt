"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Key,
  Mail,
  Play,
  RefreshCw,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { getOtpPublicAction } from "../otp-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardHeader,
  CardTitle,
  Card,
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
  isPlus?: boolean;
  messages?: ParsedMessage[];
}

const NO_OTP_LABEL = "Không có OTP";
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function parseAccountLine(line: string, id: number): ParsedAccount | null {
  const normalized = line
    .replace(/[｜¦]/g, "|")
    .replace(/\r/g, "\n")
    .replace(/\s*\n\s*/g, "");
  const parts = normalized.split("|").map((part) => part.trim()).filter(Boolean);

  if (parts.length < 2 || !parts[0].includes("@")) {
    return null;
  }

  return {
    id,
    email: parts[0],
    pass: parts[1],
    refreshToken: parts.length >= 4 ? parts.slice(2, -1).join("|") : "",
    clientId: parts.length >= 4 ? parts[parts.length - 1] : "",
    status: "idle",
  };
}

function parseAccountsInput(input: string) {
  const normalized = input.replace(/[｜¦]/g, "|").replace(/\r/g, "\n");
  const matches = Array.from(normalized.matchAll(EMAIL_PATTERN));

  return matches
    .map((match, index) => {
      const nextMatch = matches[index + 1];
      const record = normalized.slice(match.index ?? 0, nextMatch?.index ?? normalized.length);
      return parseAccountLine(record, index);
    })
    .filter((account): account is ParsedAccount => Boolean(account));
}

function hasChatGptPlusPlanMessage(messages: ParsedMessage[]) {
  return messages.some((message) =>
    (message.subject || "").trim().toLowerCase() === "chatgpt - your new plan",
  );
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

    const parsed = parseAccountsInput(val);

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
            isPlus: false,
          }
          : account,
      ),
    );

    try {
      const result = await getOtpPublicAction(acc.email, acc.pass, acc.refreshToken, acc.clientId);

      if (result.success && result.messages) {
        const otpMsg = result.messages.find((message: ParsedMessage) => Boolean(message.otp));
        const isPlus = hasChatGptPlusPlanMessage(result.messages);

        setAccounts((prev) =>
          prev.map((account) =>
            account.id === id
              ? {
                ...account,
                status: "success",
                otp: otpMsg ? otpMsg.otp : NO_OTP_LABEL,
                isPlus,
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
    setSelectedAccountId(accounts[0].id);

    await Promise.all(accounts.map((account) => scanSingleAccount(account.id)));

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

  const stats = [
    { label: "Tài khoản", value: totalAccs, className: "text-stone-900" },
    { label: "Đang quét", value: loadingAccs, className: "text-amber-700" },
    { label: "Thành công", value: successAccs, className: "text-emerald-700" },
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
              <div className="text-sm font-semibold">Bulk Hotmail</div>
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
        <div className="grid grid-cols-1 gap-6">
          <section className="space-y-6">
            <Card className="border-stone-200 bg-white/90 shadow-sm">
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base text-stone-900">
                    <Users className="h-4 w-4 text-stone-500" />
                    Danh sách tài khoản
                  </CardTitle>
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
                  placeholder="email@hotmail.com|matkhau"
                  value={rawInput}
                  onChange={(e) => handleTextareaChange(e.target.value)}
                  className="min-h-[180px] max-h-[320px] rounded-lg border-stone-200 bg-stone-50 text-sm leading-6 text-stone-900 placeholder:text-stone-400 focus-visible:ring-amber-500"
                />
                <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs leading-5 text-stone-600">
                  <div>email|password</div>
                  <div>email|password|refresh_token|client_id</div>
                </div>

                {totalAccs > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-stone-200 pt-4 sm:grid-cols-4">
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

                                {acc.isPlus && (
                                  <Badge variant="success" className="bg-sky-50 text-sky-700">
                                    Plus
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
                                Lấy mã
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
        </div>
      </div>

      <footer className="border-t border-stone-200/80 py-6 text-center text-xs text-stone-500">
        <p>© 2026 ChatGPT Reg-Tools. Developed for premium access utility.</p>
      </footer>
    </main>
  );
}
