"use client";

import React from "react";
import { ShieldCheck, Globe, EyeOff, AlertTriangle, Zap, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function ChatGPTUsageGuidelines() {
  return (
    <Card className="border-slate-800/80 bg-slate-900/40 backdrop-blur-lg relative overflow-hidden shadow-2xl">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-amber-500" />
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-200">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          Nguyên Tắc Sử Dụng Tài Khoản ChatGPT Plus Trial Bền Vững
        </CardTitle>
        <CardDescription className="text-xs text-slate-400 mt-1">
          Lưu ý quan trọng từ các chuyên gia MMO giúp tăng độ tin cậy (trust) cho tài khoản, hạn chế tối đa bị hệ thống OpenAI quét khóa (die) hàng loạt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-xs text-slate-300">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          <div className="bg-slate-950/40 border border-slate-900 p-3.5 rounded-xl space-y-1.5 hover:border-slate-800/80 transition-colors">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <Globe className="h-4 w-4 shrink-0" />
              <span>1. IP Dân Cư Sạch (Clean Proxy)</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Tuyệt đối không dùng các VPN miễn phí hoặc Proxy dùng chung chất lượng kém vì OpenAI quét dải IP rất gắt. Nên ưu tiên Proxy dân cư sạch hoặc các VPN trả phí uy tín (Mỹ, Singapore, EU) để đăng nhập.
            </p>
          </div>

          <div className="bg-slate-950/40 border border-slate-900 p-3.5 rounded-xl space-y-1.5 hover:border-slate-800/80 transition-colors">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <EyeOff className="h-4 w-4 shrink-0" />
              <span>2. Trình Duyệt Cách Ly (Anti-detect)</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Sử dụng các trình duyệt ẩn danh chuyên dụng (GPM, AdsPower, Multilogin) hoặc ít nhất tạo các Profile riêng trên Chrome/Edge. Dọn sạch Cookies/Cache trước khi đăng nhập tài khoản khác để tránh liên đới thiết bị.
            </p>
          </div>

          <div className="bg-slate-950/40 border border-slate-900 p-3.5 rounded-xl space-y-1.5 hover:border-slate-800/80 transition-colors">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>3. Không Đăng Nhập Dồn Dập</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Hạn chế đăng nhập một tài khoản trên nhiều thiết bị ở các quốc gia khác nhau trong thời gian ngắn (độ trễ địa lý). Không thay đổi mật khẩu hoặc email liên tục ngay sau khi nhận tài khoản.
            </p>
          </div>

          <div className="bg-slate-950/40 border border-slate-900 p-3.5 rounded-xl space-y-1.5 hover:border-slate-800/80 transition-colors">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <Zap className="h-4 w-4 shrink-0" />
              <span>4. Hạn Chế Tần Suất Cao (Rate Limit)</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Không gửi câu hỏi dồn dập quá nhanh hoặc treo các công cụ auto-bot tự động gọi API hàng ngàn lần qua tài khoản Trial. Cơ chế tự động của OpenAI sẽ tự quét khóa (die) các tài khoản có hành vi bất thường.
            </p>
          </div>

        </div>

        <div className="border-t border-slate-800/80 pt-4 mt-2 space-y-3">
          <div className="text-amber-400 font-extrabold text-[12px] uppercase tracking-wider flex items-center gap-1.5">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            LƯU Ý CỐT LÕI ĐỂ TĂNG ĐỘ TRUST & TRÁNH OPENAI QUÉT DIE
          </div>
          
          <div className="bg-amber-950/20 border border-amber-500/10 rounded-xl p-3.5 space-y-2.5 text-[11px] leading-relaxed text-slate-300">
            <p>
              Để tài khoản <strong>ChatGPT Plus Trial</strong> đạt độ tin cậy cao nhất trên máy chủ OpenAI, bạn cần thực hiện đúng quy trình <strong>"Warm-up" (Làm ấm)</strong> tài khoản ngay sau khi mua:
            </p>
            
            <ul className="space-y-2 list-none pl-0">
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-bold shrink-0">✦ Bước 1:</span>
                <span><strong>Làm ấm trình duyệt (Browser Warmup):</strong> Trước khi mở OpenAI, hãy dùng Profile trình duyệt mới truy cập một vài trang tin tức lớn hoặc tìm kiếm Google ngẫu nhiên để tạo lịch sử web (history) tự nhiên.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-bold shrink-0">✦ Bước 2:</span>
                <span><strong>Tuyệt đối không "vã code" ngay lập tức:</strong> Nếu bạn mua tài khoản về để viết code (gọi API, sinh mã nguồn nặng, vã Codex,...), <strong>tuyệt đối không được đưa vào sử dụng ngay</strong>. Hãy trò chuyện (chat) hội thoại thông thường trước ít nhất vài câu ngắn (ví dụ chào hỏi, hỏi kiến thức chung) để "ngâm" tài khoản và tích lũy độ trust ban đầu trên hệ thống OpenAI rồi mới mang đi viết code.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-bold shrink-0">✦ Bước 3:</span>
                <span><strong>Không thay đổi mật khẩu/email dồn dập:</strong> Hệ thống AI của OpenAI rất nhạy cảm với việc IP thay đổi đột ngột kết hợp đổi thông tin đăng nhập cấp tốc. Hãy sử dụng ổn định tài khoản tối thiểu <strong>24 giờ</strong> rồi mới tiến hành thay đổi thông tin.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-bold shrink-0">✦ Bước 4:</span>
                <span><strong>Tần suất hoạt động tự nhiên:</strong> Giữ khoảng cách tối thiểu 10-15 giây giữa các câu hỏi trong 5 phút đầu tiên, tránh copy-paste lượng lớn nội dung dồn dập dễ bị bot bảo mật tự động gắn cờ spam.</span>
              </li>
            </ul>
            
            <div className="bg-emerald-950/20 border border-emerald-500/10 p-2.5 rounded-lg text-emerald-400 font-bold flex items-center gap-1.5 text-[10px]">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>Tuân thủ đầy đủ 4 bước trên giúp nâng cao độ trust của tài khoản lên đến 95% và tránh quét die tự động!</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
