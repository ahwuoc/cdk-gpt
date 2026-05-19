"use client";

import React from "react";
import { ShieldCheck, Globe, EyeOff, AlertTriangle, Zap, Sparkles, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function ChatGPTUsageGuidelines() {
  return (
    <Card
      className="border-slate-800/80 bg-gradient-to-b from-slate-900/60 to-slate-950/80 backdrop-blur-xl relative overflow-hidden shadow-2xl rounded-2xl"
      style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
    >
      {/* Premium accent border on top */}
      <div className="absolute top-0 left-0 w-full h-[4px] bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-500 shadow-[0_1px_15px_rgba(245,158,11,0.4)]" />

      {/* Decorative ambient background glows */}
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      <CardContent className="p-5 md:p-6 space-y-5">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-600/20 border border-amber-500/30 flex items-center justify-center shadow-inner">
              <ShieldCheck className="h-5 w-5 text-amber-400 shrink-0 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold tracking-wide text-slate-100 uppercase flex items-center gap-2">
                Cẩm Nang Warm-Up & Bảo Vệ Tài Khoản ChatGPT Plus Trial
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Khuyên đọc
                </span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5 font-normal">
                Tuân thủ quy trình dưới đây sẽ giúp tăng độ tin cậy (trust score) và tối ưu hóa tuổi thọ tài khoản tối đa.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-amber-400 font-semibold bg-amber-500/5 px-2.5 py-1 rounded-lg border border-amber-500/10 self-start sm:self-auto">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Độ bền cao x3 lần</span>
          </div>
        </div>

        {/* 4-Step Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* Card 1 */}
          <div className="group relative bg-slate-950/40 hover:bg-slate-950/60 border border-slate-900 hover:border-slate-800/80 p-4 rounded-xl transition-all duration-300 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center border border-sky-500/20 text-sky-400 group-hover:scale-110 transition-transform">
                    <Globe className="h-4 w-4" />
                  </div>
                  <span className="font-bold text-xs text-slate-200 tracking-wide">1. IP Sạch (Clean Proxy)</span>
                </div>
                <span className="text-[9px] font-mono text-slate-600 group-hover:text-sky-500 transition-colors">STEP 01</span>
              </div>
              <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                <p className="font-medium text-slate-300">Sử dụng kết nối chất lượng cao:</p>
                <ul className="list-disc pl-3.5 space-y-1 text-slate-400">
                  <li>Nên dùng <strong className="text-sky-400">Proxy dân cư sạch</strong> hoặc VPN trả phí uy tín (Nord, Express).</li>
                  <li>Tuyệt đối <span className="text-rose-400 font-medium">tránh VPN miễn phí/VPS bẩn</span> đã bị hàng nghìn tài khoản dùng chung.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div className="group relative bg-slate-950/40 hover:bg-slate-950/60 border border-slate-900 hover:border-slate-800/80 p-4 rounded-xl transition-all duration-300 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20 text-purple-400 group-hover:scale-110 transition-transform">
                    <EyeOff className="h-4 w-4" />
                  </div>
                  <span className="font-bold text-xs text-slate-200 tracking-wide">2. Trình Duyệt Sạch</span>
                </div>
                <span className="text-[9px] font-mono text-slate-600 group-hover:text-purple-500 transition-colors">STEP 02</span>
              </div>
              <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                <p className="font-medium text-slate-300">Tách biệt dữ liệu duyệt web:</p>
                <ul className="list-disc pl-3.5 space-y-1 text-slate-400">
                  <li>Tạo một <strong className="text-purple-400">Profile riêng biệt</strong> trên Chrome/Edge để đăng nhập.</li>
                  <li>Khuyên dùng các trình duyệt ẩn danh chuyên dụng <strong className="text-purple-400">(Anti-detect)</strong> nếu nuôi nhiều tài khoản.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Card 3 */}
          <div className="group relative bg-amber-500/[0.02] hover:bg-amber-500/[0.04] border border-amber-500/10 hover:border-amber-500/35 p-4 rounded-xl transition-all duration-300 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-400 group-hover:scale-110 transition-transform">
                    <Zap className="h-4 w-4 text-amber-400" />
                  </div>
                  <span className="font-bold text-xs text-slate-200 tracking-wide text-amber-400 animate-pulse">3. Bắt Buộc "Warm-up"</span>
                </div>
                <span className="text-[9px] font-mono text-slate-600 group-hover:text-amber-500 transition-colors">STEP 03</span>
              </div>
              <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                <p className="font-medium text-amber-300">Nuôi dưỡng độ tin cậy:</p>
                <ul className="list-disc pl-3.5 space-y-1 text-slate-300">
                  <li><strong className="text-amber-400">Tương tác tự nhiên:</strong> Hỏi đáp vài câu chuyện thông thường trước khi làm việc.</li>
                  <li>⚠️ <span className="text-rose-400 font-bold underline">Cực kỳ kỵ:</span> Vừa đăng nhập đã dán các đoạn code lập trình dài vào ngay lập tức.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Card 4 */}
          <div className="group relative bg-slate-950/40 hover:bg-slate-950/60 border border-slate-900 hover:border-slate-800/80 p-4 rounded-xl transition-all duration-300 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform">
                    <AlertTriangle className="h-4 w-4 text-emerald-400" />
                  </div>
                  <span className="font-bold text-xs text-slate-200 tracking-wide">4. Giữ Nguyên Thông Tin</span>
                </div>
                <span className="text-[9px] font-mono text-slate-600 group-hover:text-emerald-500 transition-colors">STEP 04</span>
              </div>
              <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                <p className="font-medium text-slate-300">Đợi tài khoản liên kết thiết bị:</p>
                <ul className="list-disc pl-3.5 space-y-1 text-slate-400">
                  <li>Để tài khoản hoạt động ổn định trên trình duyệt từ <strong className="text-emerald-400">24h - 48h</strong>.</li>
                  <li>Không đổi mật khẩu hoặc thông tin cá nhân ngay lập tức tránh kích hoạt cơ chế tự động khóa.</li>
                </ul>
              </div>
            </div>
          </div>

        </div>

        {/* Highlight Alert Box - The Crucial Hack */}
        <div className="relative rounded-xl border border-rose-500/20 bg-gradient-to-r from-rose-950/20 via-slate-900/40 to-slate-900/40 p-4 shadow-md overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/[0.03] rounded-full blur-2xl pointer-events-none" />

          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
              <ShieldAlert className="h-5 w-5 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-black tracking-wider text-rose-400 uppercase flex items-center gap-1.5">
                Cảnh báo quan trọng bậc nhất: Tránh quét Codex
              </h4>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Hành động <strong className="text-rose-300 font-semibold">"vã code" (dán các đoạn code lập trình dài hoặc chạy script)</strong> ngay lập tức sau khi đăng nhập là hành vi bị AI của OpenAI quét cực kỳ gắt gao. Hãy "chat ngâm" kỹ với các chủ đề bình thường để tăng độ trust trước khi mang đi làm việc!
              </p>
            </div>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
