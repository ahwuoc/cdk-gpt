"use client";

import React from "react";
import { ShieldCheck, Globe, EyeOff, AlertTriangle, Zap, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function ChatGPTUsageGuidelines() {
  return (
    <Card className="border-slate-800/80 bg-slate-900/40 backdrop-blur-lg relative overflow-hidden shadow-2xl">
      <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-500" />
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4.5 w-4.5 text-emerald-400 shrink-0" />
          <h2 className="text-xs font-bold tracking-wide text-slate-100 uppercase">
            Cẩm nang Warm-up & Sử dụng tài khoản ChatGPT Plus Trial bền bỉ
          </h2>
        </div>

        {/* Concise Guidelines Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="bg-slate-950/40 border border-slate-900/80 p-3 rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-400">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span>1. IP Sạch (Clean Proxy)</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Tránh VPN miễn phí/VPS bẩn. Hãy dùng Proxy dân cư sạch hoặc VPN trả phí chất lượng.
            </p>
          </div>

          <div className="bg-slate-950/40 border border-slate-900/80 p-3 rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-400">
              <EyeOff className="h-3.5 w-3.5 shrink-0" />
              <span>2. Trình duyệt sạch</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Dùng trình duyệt ẩn danh chuyên dụng (Anti-detect) hoặc tạo profile riêng trên Chrome/Edge.
            </p>
          </div>

          <div className="bg-slate-950/40 border border-slate-900/80 p-3 rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-400">
              <Zap className="h-3.5 w-3.5 shrink-0 animate-pulse text-amber-400" />
              <span>3. Bắt buộc "Warm-up"</span>
            </div>
            <p className="text-amber-300 text-[11px] leading-relaxed font-semibold">
              ⚠️ KHÔNG vác đi code ngay! Chat ngâm vài câu hỏi thông thường trước để tăng độ trust.
            </p>
          </div>

          <div className="bg-slate-950/40 border border-slate-900/80 p-3 rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>4. Không đổi thông tin ngay</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Để tài khoản hoạt động ổn định trên thiết bị từ 24h - 48h rồi mới tiến hành đổi mật khẩu.
            </p>
          </div>
        </div>

        <div className="bg-emerald-950/20 border border-emerald-500/10 p-2.5 rounded-lg text-emerald-400 font-bold flex items-center gap-1.5 text-[10px]">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <span>MẸO QUAN TRỌNG: Vã code (Codex) ngay lập tức sau khi đăng nhập là hành vi bị OpenAI quét gắt gao nhất. Hãy warm-up kỹ trước khi dùng!</span>
        </div>
      </CardContent>
    </Card>
  );
}
