"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  Copy,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Upload,
  ExternalLink,
  Info,
  Server,
  ArrowRightLeft,
  Settings,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";

// --- Typings ---
interface ChatGPTUser {
  id?: string;
  email?: string;
}

interface ChatGPTAccount {
  id?: string;
  planType?: string;
}

interface ChatGPTSession {
  user?: ChatGPTUser;
  expires?: string;
  expiresAt?: string;
  expired?: string;
  expires_at?: string;
  account?: ChatGPTAccount;
  account_id?: string;
  chatgptAccountId?: string;
  accessToken?: string;
  access_token?: string;
  sessionToken?: string;
  session_token?: string;
  refreshToken?: string;
  refresh_token?: string;
  idToken?: string;
  id_token?: string;
  authProvider?: string;
  auth_provider?: string;
  disabled?: boolean;
  testStatus?: string;
  priority?: number | string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

interface ConvertedResult {
  sourceName: string;
  sourcePath?: string;
  email?: string;
  name?: string;
  expiresAt?: string;
  nineRouter: any;
}

interface SkippedResult {
  sourceName: string;
  path?: string;
  reason: string;
}

// --- Helper Functions ---
function isPlainObject(value: any): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmpty(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseJwtPayload(token?: string): any {
  if (typeof token !== "string" || token.trim() === "") {
    return undefined;
  }
  const segments = token.split(".");
  if (segments.length < 2) {
    return undefined;
  }
  try {
    return JSON.parse(decodeBase64Url(segments[1]));
  } catch {
    return undefined;
  }
}

function getOpenAIAuthSection(payload: any) {
  if (!isPlainObject(payload)) {
    return {};
  }
  const auth = payload["https://api.openai.com/auth"];
  return isPlainObject(auth) ? auth : {};
}

function getOpenAIProfileSection(payload: any) {
  if (!isPlainObject(payload)) {
    return {};
  }
  const profile = payload["https://api.openai.com/profile"];
  return isPlainObject(profile) ? profile : {};
}

function normalizeTimestamp(value: any): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1e11 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timestampFromUnixSeconds(value: any): string | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  const date = new Date(numeric * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getExpiresIn(expiresAt?: string, now = new Date()): number | undefined {
  if (!expiresAt) {
    return undefined;
  }
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) {
    return undefined;
  }
  return Math.max(0, Math.floor((expiresMs - now.getTime()) / 1000));
}

function stripUnavailable(value: any): any {
  if (Array.isArray(value)) {
    return value.map(stripUnavailable).filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, stripUnavailable(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return value;
}

function sanitizeFileToken(value?: string, fallback = "chatgpt-session"): string {
  const base = firstNonEmpty(value, fallback) || fallback;
  return base
    .replace(/\.[^.]+$/u, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || fallback;
}

function getTimestampToken(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

function formatDisplayDate(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function collectSessionLikeObjects(value: any, sourceName = "pasted-json"): any[] {
  const found: any[] = [];
  const visited = new WeakSet();

  function visit(item: any, path: string) {
    if (!isPlainObject(item) && !Array.isArray(item)) {
      return;
    }

    if (isPlainObject(item)) {
      if (visited.has(item)) {
        return;
      }
      visited.add(item);

      const token = firstNonEmpty(
        item.accessToken,
        item.access_token,
        item.token?.accessToken,
        item.token?.access_token,
        item.credentials?.accessToken,
        item.credentials?.access_token,
      );
      const hasIdentity = isPlainObject(item.user) || firstNonEmpty(
        item.email,
        item.name,
        item.providerSpecificData?.chatgptAccountId,
        item.providerSpecificData?.chatgpt_account_id,
        item.id,
      );
      if (token && hasIdentity) {
        found.push({ value: item, sourceName, path });
        return;
      }

      for (const [key, child] of Object.entries(item)) {
        if (key === "accessToken" || key === "access_token" || key === "sessionToken") {
          continue;
        }
        visit(child, `${path}.${key}`);
      }
      return;
    }

    item.forEach((child: any, index: number) => visit(child, `${path}[${index}]`));
  }

  visit(value, "$");
  return found;
}

function convertSession(record: any, options: { now?: Date; sourceName?: string; sourcePath?: string } = {}): ConvertedResult {
  if (!isPlainObject(record)) {
    throw new Error("Session is not a JSON object");
  }

  const accessToken = firstNonEmpty(
    record.accessToken,
    record.access_token,
    record.token?.accessToken,
    record.token?.access_token,
    record.credentials?.accessToken,
    record.credentials?.access_token,
  );
  if (!accessToken) {
    throw new Error("Missing accessToken");
  }

  const sessionToken = firstNonEmpty(
    record.sessionToken,
    record.session_token,
    record.token?.sessionToken,
    record.token?.session_token,
    record.credentials?.session_token,
  );
  const refreshToken = firstNonEmpty(
    record.refreshToken,
    record.refresh_token,
    record.token?.refreshToken,
    record.token?.refresh_token,
    record.credentials?.refresh_token,
    sessionToken, // Fallback: Map ChatGPT sessionToken to 9router's refreshToken
  );

  const payload = parseJwtPayload(accessToken);
  const auth = getOpenAIAuthSection(payload);
  const profile = getOpenAIProfileSection(payload);

  const expiresAt = firstNonEmpty(
    payload ? timestampFromUnixSeconds(payload.exp) : undefined,
    normalizeTimestamp(record.expires),
    normalizeTimestamp(record.expiresAt),
    normalizeTimestamp(record.expired),
    normalizeTimestamp(record.expires_at),
  );
  const email = firstNonEmpty(
    record.user?.email,
    record.email,
    record.credentials?.email,
    record.providerSpecificData?.email,
    profile.email,
    payload?.email,
  );
  const accountId = firstNonEmpty(
    record.account?.id,
    record.account_id,
    record.chatgptAccountId,
    record.providerSpecificData?.chatgptAccountId,
    record.providerSpecificData?.chatgpt_account_id,
    record.credentials?.chatgpt_account_id,
    auth.chatgpt_account_id,
    record.provider === "codex" ? record.id : undefined,
  );
  const planType = firstNonEmpty(
    record.account?.planType,
    record.account?.plan_type,
    record.planType,
    record.plan_type,
    record.providerSpecificData?.chatgptPlanType,
    record.providerSpecificData?.chatgpt_plan_type,
    record.credentials?.plan_type,
    auth.chatgpt_plan_type,
  );
  const exportedAt = normalizeTimestamp(options.now || new Date());
  const expiresIn = getExpiresIn(expiresAt, options.now || new Date());
  const sourceName = firstNonEmpty(options.sourceName, "pasted-json") || "pasted-json";
  const name = firstNonEmpty(email, sourceName, "ChatGPT Account") || "ChatGPT Account";

  const priority = Number.isFinite(Number(record.priority)) ? Number(record.priority) : 9;
  const isActive = typeof record.isActive === "boolean" ? record.isActive : !Boolean(record.disabled);
  const createdAt = normalizeTimestamp(record.createdAt) || exportedAt;
  const updatedAt = normalizeTimestamp(record.updatedAt) || exportedAt;

  const nineRouter = stripUnavailable({
    accessToken,
    refreshToken,
    expiresAt,
    testStatus: firstNonEmpty(record.testStatus, record.test_status, "active"),
    expiresIn,
    providerSpecificData: {
      chatgptAccountId: accountId,
      chatgptPlanType: planType,
    },
    id: accountId,
    provider: "codex",
    authType: "oauth",
    name,
    email,
    priority,
    isActive,
    createdAt,
    updatedAt,
  });

  return {
    sourceName,
    sourcePath: options.sourcePath,
    email,
    name,
    expiresAt,
    nineRouter,
  };
}

export default function SessionConverterPage() {
  const [inputText, setInputText] = useState("");
  const [converted, setConverted] = useState<ConvertedResult[]>([]);
  const [skipped, setSkipped] = useState<SkippedResult[]>([]);
  const [outputText, setOutputText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse template example
  const loadExample = () => {
    const exampleSession = {
      user: {
        id: "user-example-12345",
        email: "demo-user@9router.com",
      },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      account: {
        id: "account-plus-99999",
        planType: "plus",
      },
      accessToken: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjE3ODQ2MDAwMDAsImVtYWlsIjoiZGVtby11c2VyQDlyb3V0ZXIuY29tIiwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImNoYXRncHRfYWNjb3VudF9pZCI6ImFjY291bnQtcGx1cy05OTk5OSIsImNoYXRncHRfcGxhbl90eXBlIjoicGx1cyJ9fQ.",
      sessionToken: "sess-token-example-xyz",
      authProvider: "openai",
    };
    setInputText(JSON.stringify(exampleSession, null, 2));
    toast.success("Đã tải JSON ví dụ mẫu cho 9router!");
  };

  // Main processing function
  useEffect(() => {
    if (!inputText.trim()) {
      setConverted([]);
      setSkipped([]);
      setOutputText("");
      return;
    }

    try {
      const parsed = JSON.parse(inputText);
      const sources = collectSessionLikeObjects(parsed);
      const results: ConvertedResult[] = [];
      const skippedItems: SkippedResult[] = [];
      const now = new Date();

      sources.forEach((item, index) => {
        try {
          results.push(
            convertSession(item.value, {
              now,
              sourceName: item.sourceName,
              sourcePath: item.path || `$[${index}]`,
            })
          );
        } catch (error: any) {
          skippedItems.push({
            sourceName: item.sourceName,
            path: item.path,
            reason: error?.message || "Không thể chuyển đổi",
          });
        }
      });

      if (sources.length === 0) {
        skippedItems.push({
          sourceName: "pasted-json",
          path: "$",
          reason: "Không tìm thấy đối tượng Session hợp lệ chứa accessToken và user/email.",
        });
      }

      setConverted(results);
      setSkipped(skippedItems);
    } catch (error: any) {
      setConverted([]);
      setSkipped([
        {
          sourceName: "pasted-json",
          path: "$",
          reason: `Lỗi phân tích cú pháp JSON: ${error?.message}`,
        },
      ]);
      setOutputText("");
    }
  }, [inputText]);

  // Generate output text directly as 9router schema (Always wrapped in an array)
  useEffect(() => {
    if (converted.length === 0) {
      setOutputText("");
      return;
    }

    // Always output as a JSON array because 9router batch importer expects an array [ { ... } ]
    const outputObj = converted.map((item) => item.nineRouter);

    setOutputText(JSON.stringify(outputObj, null, 2));
  }, [converted]);

  // File handling
  const handleFiles = async (files: FileList) => {
    const jsonFiles = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".json"));
    if (jsonFiles.length === 0) {
      toast.error("Vui lòng chỉ chọn các tệp tin .json");
      return;
    }

    const documents: any[] = [];
    const skippedItems: SkippedResult[] = [];

    for (const file of jsonFiles) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const found = collectSessionLikeObjects(parsed, file.name);
        if (found.length === 0) {
          skippedItems.push({
            sourceName: file.name,
            path: "$",
            reason: "Không tìm thấy đối tượng Session hợp lệ chứa accessToken và user/email.",
          });
        }
        documents.push(...found);
      } catch (error: any) {
        skippedItems.push({
          sourceName: file.name,
          path: "$",
          reason: `Lỗi đọc tệp tin hoặc phân tích cú pháp: ${error?.message}`,
        });
      }
    }

    const now = new Date();
    const results: ConvertedResult[] = [];
    const convertSkipped = [...skippedItems];

    documents.forEach((item) => {
      try {
        results.push(
          convertSession(item.value, {
            now,
            sourceName: item.sourceName,
            sourcePath: item.path,
          })
        );
      } catch (error: any) {
        convertSkipped.push({
          sourceName: item.sourceName,
          path: item.path,
          reason: error?.message || "Không thể chuyển đổi",
        });
      }
    });

    setConverted(results);
    setSkipped(convertSkipped);

    if (documents.length > 0) {
      const mergedInput = documents.map(d => d.value);
      setInputText(JSON.stringify(mergedInput.length === 1 ? mergedInput[0] : mergedInput, null, 2));
      toast.success(`Đã nhập thành công ${results.length} tài khoản từ tệp JSON!`);
    } else {
      toast.error("Không tìm thấy tài khoản hợp lệ trong các tệp tin đã tải lên.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleCopy = async () => {
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
      toast.success("Đã sao chép cấu hình JSON cho 9router!");
    } catch {
      toast.error("Không thể tự động sao chép. Vui lòng chọn và sao chép thủ công.");
    }
  };

  const handleDownload = () => {
    if (!outputText) return;
    const first = converted[0];
    const base = sanitizeFileToken(first?.email || first?.name || "9router");
    const fileName = `${base}.9router.${getTimestampToken()}.json`;
    const blob = new Blob([outputText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Đã tải xuống ${fileName}!`);
  };

  return (
    <main className="min-h-screen py-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto selection:bg-amber-600 selection:text-white antialiased">

      {/* Decorative Top Glowing Blob */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-80 bg-gradient-to-b from-amber-500/10 via-amber-600/5 to-transparent rounded-full blur-3xl -z-10 pointer-events-none" />

      {/* Header Panel - Re-styled for premium visual layout */}
      <header className="mb-12 text-center relative max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-800 text-xs font-bold mb-4 shadow-sm animate-pulse">
          <Sparkles className="w-3.5 h-3.5" />
          Giải pháp xuất cấu hình tự động
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-stone-900 tracking-tight leading-none mb-4 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3">
          <span className="flex items-center gap-2">
            <Server className="w-10 h-10 text-amber-600 drop-shadow-[0_2px_8px_rgba(217,119,6,0.3)] animate-pulse" />
            ChatGPT Session to
          </span>
          <span className="bg-gradient-to-r from-amber-600 via-amber-700 to-amber-900 bg-clip-text text-transparent drop-shadow-sm font-black relative">
            9router
            <span className="absolute -bottom-1 left-0 w-full h-[3px] bg-gradient-to-r from-amber-500 to-amber-700 rounded-full" />
          </span>
        </h1>
        <p className="text-stone-600 text-base sm:text-lg font-semibold leading-relaxed mt-4">
          Chuyển đổi trực tiếp dữ liệu ChatGPT Web Session thành cấu hình JSON tương thích hoàn toàn để import trực tiếp vào hệ thống <strong className="text-amber-800">9router</strong>.
        </p>
      </header>

      {/* Main Grid: Input / Output panes styled as premium Glassmorphism cards */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">

        {/* Left Column: Input Panel */}
        <section className="lg:col-span-6 flex flex-col">
          <div className="h-full bg-white/40 backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-white/50 shadow-[0_8px_32px_0_rgba(120,53,4,0.04)] hover:shadow-[0_8px_32px_0_rgba(120,53,4,0.08)] transition-all duration-300 flex flex-col group">

            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg sm:text-xl font-black text-stone-850 flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                  <FileText className="w-5 h-5" />
                </div>
                Dữ liệu Web Session
              </h2>

              <button
                onClick={loadExample}
                className="text-xs font-extrabold text-amber-700 hover:text-amber-500 bg-amber-50 hover:bg-amber-100/50 hover:scale-[1.02] active:scale-[0.98] border border-amber-200/40 transition-all duration-200 px-3.5 py-2 rounded-xl flex items-center gap-2 shadow-sm"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" />
                Dùng Mẫu Thử
              </button>
            </div>

            {/* Instruction Link (Enhanced Accordion Card look) */}
            <div className="bg-amber-50/40 border border-amber-200/30 rounded-2xl p-4 sm:p-5 mb-5 text-sm text-stone-700 shadow-inner">
              <p className="font-bold text-stone-900 mb-1.5 flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-600" />
                Lấy dữ liệu Session ở đâu?
              </p>
              <p className="mb-3 text-stone-600 leading-relaxed">
                Đăng nhập vào ChatGPT trên trình duyệt, sau đó nhấn vào đường dẫn chính thức dưới đây và copy toàn bộ nội dung JSON:
              </p>
              <a
                href="https://chatgpt.com/api/auth/session"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-bold text-white bg-amber-600 hover:bg-amber-500 hover:scale-[1.02] active:scale-[0.98] px-4 py-2 rounded-xl shadow-md shadow-amber-600/15 border border-amber-700/10 transition-all duration-200"
              >
                Mở link lấy Session
                <ExternalLink className="w-4 h-4" />
              </a>
              <p className="mt-3.5 text-xs text-amber-800 font-bold bg-amber-100/40 border border-amber-200/50 p-3 rounded-xl leading-relaxed">
                ⚠️ Bảo mật: Chuỗi JSON này chứa khóa đăng nhập accessToken và sessionToken, không gửi cho bất kỳ ai khác!
              </p>
            </div>

            {/* Drag and Drop Zone (Restyled) */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`relative flex-1 flex flex-col min-h-[300px] rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden ${isDragging
                ? "border-amber-500 bg-amber-50/30 scale-[1.01] shadow-lg shadow-amber-500/5"
                : "border-stone-200 bg-stone-50/20 group-hover:border-stone-300"
                }`}
            >
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder='Dán toàn bộ đoạn mã JSON Session từ ChatGPT vào đây (hoặc kéo thả một tệp tin .json vào đây)...'
                className="w-full h-full p-5 resize-none bg-transparent outline-none text-stone-850 font-mono text-sm leading-relaxed placeholder:text-stone-400 focus:ring-0 focus:border-0"
              />

              {/* Hover Drop File Indicator */}
              {isDragging && (
                <div className="absolute inset-0 bg-gradient-to-b from-amber-600/90 to-amber-700/90 backdrop-blur-sm flex flex-col items-center justify-center text-white pointer-events-none transition duration-300">
                  <Upload className="w-12 h-12 mb-3 animate-bounce" />
                  <p className="font-extrabold text-xl">Thả tệp tin JSON vào đây</p>
                  <p className="text-sm opacity-80 mt-1">Hệ thống sẽ tự động chuyển đổi ngay lập tức</p>
                </div>
              )}

              {/* Empty Input Guide overlay */}
              {!inputText && !isDragging && (
                <div className="absolute inset-x-0 bottom-5 pointer-events-none flex justify-center">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="pointer-events-auto bg-white hover:bg-stone-50 border border-stone-200/80 hover:border-stone-300 active:scale-[0.98] transition px-4 py-2.5 rounded-xl text-stone-700 text-xs font-bold shadow-md flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5 text-stone-500 animate-pulse" />
                    Hoặc chọn tệp từ máy tính
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    multiple
                    onChange={(e) => {
                      if (e.target.files) handleFiles(e.target.files);
                    }}
                    className="hidden"
                  />
                </div>
              )}
            </div>

            {/* Input Status Indicators */}
            <div className="mt-4 flex items-center justify-between text-xs font-extrabold text-stone-450 border-t border-stone-100 pt-3.5">
              <span className="flex items-center gap-1.5">
                {inputText ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Đã nhập dữ liệu thành công
                  </>
                ) : (
                  <>
                    <HelpCircle className="w-4 h-4 text-stone-400" />
                    Đang chờ dán JSON Session
                  </>
                )}
              </span>
              <span className="bg-stone-100 text-stone-600 px-2 py-0.5 rounded-md font-mono text-[10px]">
                {inputText ? `${inputText.length.toLocaleString()} ký tự` : "Trống"}
              </span>
            </div>

          </div>
        </section>

        {/* Right Column: Output Panel (Formatted as premium terminal window) */}
        <section className="lg:col-span-6 flex flex-col">
          <div className="h-full bg-white/40 backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-white/50 shadow-[0_8px_32px_0_rgba(120,53,4,0.04)] hover:shadow-[0_8px_32px_0_rgba(120,53,4,0.08)] transition-all duration-300 flex flex-col justify-between group">

            <div className="flex flex-col h-full justify-between">

              {/* Output Header */}
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg sm:text-xl font-black text-stone-850 flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                    <ArrowRightLeft className="w-5 h-5 animate-pulse" />
                  </div>
                  Đầu Ra 9router JSON
                </h2>

                {converted.length > 0 && (
                  <span className="bg-emerald-500/10 text-emerald-800 border border-emerald-500/20 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 animate-fadeIn">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Đã nhận diện: {converted.length} acc
                  </span>
                )}
              </div>

              {/* Textarea output inside dark velvet terminal frame */}
              <div className="relative flex-1 min-h-[300px] bg-stone-950/95 rounded-2xl overflow-hidden shadow-2xl border border-stone-850 flex flex-col">
                {/* Terminal Header Bar */}
                <div className="bg-stone-900 px-4 py-3 border-b border-stone-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-rose-500/80" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/80" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-[10px] font-bold text-stone-500 font-mono">9router_config_array.json</span>
                </div>

                <textarea
                  readOnly
                  value={outputText}
                  placeholder="Cấu hình JSON tương thích hoàn toàn với 9router sẽ hiển thị tự động tại đây..."
                  className="w-full flex-1 p-5 resize-none outline-none font-mono text-xs text-amber-400 bg-transparent placeholder:text-stone-700 leading-relaxed scrollbar-thin scrollbar-thumb-stone-800"
                />

                {outputText && (
                  <div className="absolute bottom-4 right-4 flex items-center gap-2.5">
                    <button
                      onClick={handleCopy}
                      className="bg-stone-800/90 hover:bg-stone-750 border border-stone-700/80 hover:border-amber-500/40 text-stone-200 hover:text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Sao chép
                    </button>
                    <button
                      onClick={handleDownload}
                      className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] border border-amber-700/10 transition-all duration-200"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Tải xuống
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Spec metadata block */}
            <div className="mt-5 pt-5 border-t border-stone-200/50">
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-4 text-xs text-stone-700 leading-relaxed">
                <p className="font-extrabold text-amber-900 mb-1 flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5 text-amber-700" />
                  Định dạng 9router đã được tối ưu hóa:
                </p>
                Tự động lấy <strong className="text-amber-800">sessionToken</strong> làm phương án dự phòng cho trường <strong className="text-amber-800">refreshToken</strong>, định cấu hình mảng JSON <strong className="text-amber-800">[]</strong> sẵn sàng để import hàng loạt trực tiếp.
              </div>
            </div>

          </div>
        </section>

      </div>

      {/* Bottom Section: Skipped / Error report logs */}
      {skipped.length > 0 && (
        <section className="mt-8 bg-rose-50/80 backdrop-blur-xl border border-rose-200/60 rounded-3xl p-6 shadow-md shadow-rose-100/5 animate-fadeIn">
          <h3 className="text-rose-900 font-extrabold text-base mb-3 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-700" />
            Nhật ký Lỗi / Bỏ qua ({skipped.length})
          </h3>
          <div className="font-mono text-xs text-rose-800 divide-y divide-rose-200/30 max-h-40 overflow-y-auto pr-2">
            {skipped.map((item, idx) => (
              <div key={idx} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-1">
                <span>
                  📂 Nguồn: <strong className="text-rose-900">{item.sourceName}</strong> {item.path && `(đường dẫn: ${item.path})`}
                </span>
                <span className="text-rose-700 bg-white border border-rose-200 px-2.5 py-1 rounded-lg font-sans font-extrabold">
                  {item.reason}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Bottom Section: Accounts preview list (Restyled to look premium) */}
      {converted.length > 0 && (
        <section className="mt-8 bg-white/40 backdrop-blur-xl border border-white/50 rounded-3xl p-6 sm:p-8 shadow-[0_8px_32px_0_rgba(120,53,4,0.04)] animate-fadeIn">
          <h3 className="text-stone-850 font-black text-lg sm:text-xl mb-5 flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600">
              <Server className="w-5 h-5" />
            </div>
            Danh sách tài khoản tương thích 9router đã nhận diện ({converted.length})
          </h3>

          <div className="overflow-x-auto rounded-2xl border border-stone-200/60 overflow-hidden shadow-sm bg-white/20">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-stone-50/55 border-b border-stone-200/80 text-stone-500 text-[10px] sm:text-xs uppercase tracking-wider font-black">
                  <th className="py-4 px-5">Tên tài khoản</th>
                  <th className="py-4 px-5">Email</th>
                  <th className="py-4 px-5">Hạn truy cập (Expires At)</th>
                  <th className="py-4 px-5">Nguồn dữ liệu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200/60 text-stone-700 text-xs sm:text-sm">
                {converted.map((item, index) => (
                  <tr key={index} className="hover:bg-white/40 transition duration-150">
                    <td className="py-4 px-5 font-bold text-stone-900">{item.name || "-"}</td>
                    <td className="py-4 px-5 font-mono text-stone-600 text-[11px] sm:text-xs">{item.email || "-"}</td>
                    <td className="py-4 px-5 font-semibold text-stone-600">{item.expiresAt ? formatDisplayDate(item.expiresAt) : "Vô hạn"}</td>
                    <td className="py-4 px-5">
                      <span className="text-[10px] font-extrabold text-stone-500 bg-stone-105 border border-stone-200/40 px-2.5 py-1 rounded-xl block max-w-[150px] truncate" title={item.sourceName}>
                        {item.sourceName}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
