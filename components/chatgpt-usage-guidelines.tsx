"use client";

import React from "react";
import { ShieldCheck, Globe, EyeOff, AlertTriangle, Zap, CheckCircle2, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function ChatGPTUsageGuidelines() {
  return (
    <Card className="border-slate-800/80 bg-slate-900/40 backdrop-blur-lg relative overflow-hidden shadow-2xl">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-amber-500" />
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-200">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          Cẩm Nang Sử Dụng Tài Khoản ChatGPT Plus Trial Bền Vững
        </CardTitle>
        <CardDescription className="text-xs text-slate-400 mt-1">
          Lưu ý quan trọng dựa trên cơ chế kiểm soát rủi ro (Risk Control) của OpenAI giúp tăng độ trust cho tài khoản, hạn chế tối đa bị hệ thống quét die hàng loạt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-xs text-slate-300">
        
        {/* Core Principles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          <div className="bg-slate-950/40 border border-slate-900 p-3.5 rounded-xl space-y-1.5 hover:border-slate-800/80 transition-colors">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <Globe className="h-4 w-4 shrink-0" />
              <span>1. IP Dân Cư Sạch (Clean Proxy)</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              OpenAI phân loại IP cực kỳ nghiêm ngặt. Họ tự động chặn hoặc kiểm duyệt gắt gao các IP từ máy chủ ảo (Datacenter), VPS, VPN miễn phí. Hãy luôn sử dụng <strong>Proxy dân cư sạch (Residential Proxy)</strong> hoặc các VPN trả phí chất lượng cao (Mỹ, Singapore, EU).
            </p>
          </div>

          <div className="bg-slate-950/40 border border-slate-900 p-3.5 rounded-xl space-y-1.5 hover:border-slate-800/80 transition-colors">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <EyeOff className="h-4 w-4 shrink-0" />
              <span>2. Trình Duyệt Cách Ly (Anti-detect)</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              OpenAI quét vân tay trình duyệt (fingerprinting) để tìm liên đới thiết bị. Nên sử dụng trình duyệt ẩn danh chuyên dụng (GPM, AdsPower, Multilogin) hoặc tạo Profile riêng trên Chrome/Edge. Dọn sạch Cookies/Cache trước khi đăng nhập để tránh xích chùm.
            </p>
          </div>

          <div className="bg-slate-950/40 border border-slate-900 p-3.5 rounded-xl space-y-1.5 hover:border-slate-800/80 transition-colors">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>3. Không Đăng Nhập Dồn Dập</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Việc thay đổi địa lý quá nhanh (độ trễ địa lý) giữa các lần đăng nhập sẽ kích hoạt cơ chế khóa tài khoản thích ứng. Tránh đăng nhập một tài khoản trên nhiều thiết bị ở các khu vực cách xa nhau trong thời gian ngắn.
            </p>
          </div>

          <div className="bg-slate-950/40 border border-slate-900 p-3.5 rounded-xl space-y-1.5 hover:border-slate-800/80 transition-colors">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <Zap className="h-4 w-4 shrink-0" />
              <span>4. Tần Suất Yêu Cầu Tự Nhiên</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              OpenAI giám sát tốc độ cuộn, di chuột và gõ phím. Không dán (Ctrl+V) dồn dập các đoạn Prompt siêu dài ngay lập tức mà không có hành vi di chuột chuẩn trước đó, nếu không hệ thống sẽ phân loại là hành vi của Auto-Bot.
            </p>
          </div>

        </div>

        {/* Golden Warm-up & Trust Rules Checklist */}
        <div className="border-t border-slate-800/80 pt-4 space-y-3">
          <div className="text-amber-400 font-extrabold text-[12px] uppercase tracking-wider flex items-center gap-1.5">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            LƯU Ý CỐT LÕI ĐỂ TĂNG ĐỘ TRUST & TRÁNH OPENAI QUÉT DIE
          </div>
          
          <div className="bg-amber-950/20 border border-amber-500/10 rounded-xl p-4 space-y-3 text-[11px] leading-relaxed text-slate-300">
            <p className="font-semibold text-slate-200">
              Để tài khoản <strong>ChatGPT Plus Trial</strong> tích lũy độ tin cậy ban đầu trên máy chủ OpenAI và tránh thuật toán quét tự động, vui lòng thực hiện đúng quy trình <strong>"Warm-up" (Làm ấm)</strong> sau:
            </p>
            
            <ul className="space-y-3 list-none pl-0">
              <li className="flex items-start gap-2.5">
                <span className="text-amber-500 font-extrabold shrink-0 text-xs">✦ Bước 1:</span>
                <span><strong>Làm ấm môi trường trình duyệt:</strong> Trước khi truy cập OpenAI, hãy mở Profile trình duyệt mới và tìm kiếm vài thông tin ngẫu nhiên trên Google để trình duyệt tích lũy lịch sử duyệt web (history) tự nhiên.</span>
              </li>
              
              <li className="flex items-start gap-2.5 border-l-2 border-red-500/50 pl-2 bg-red-950/10 py-1.5 rounded-r-lg">
                <span className="text-red-400 font-extrabold shrink-0 text-xs flex items-center gap-1">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  ✦ Bước 2:
                </span>
                <span>
                  <strong>TUYỆT ĐỐI KHÔNG mang đi "vã code" ngay lập tức:</strong> Sinh mã nguồn, viết code, hay gọi các tác vụ Codex tiêu thụ lượng lớn Token và tài nguyên máy chủ nên <strong>bị OpenAI kiểm duyệt gắt gao nhất bằng bộ lọc an toàn (moderation)</strong>. 
                  <br />
                  <span className="text-amber-400 font-bold block mt-1">
                    👉 BẮT BUỘC: Hãy "ngâm" tài khoản và trò chuyện (chat) hội thoại thông thường trước ít nhất vài câu hỏi ngắn (chào hỏi, hỏi kiến thức xã hội phổ thông,...) để OpenAI ghi nhận hành vi sử dụng tự nhiên của con người, sau đó mới vác đi viết code hoặc khai thác chuyên sâu!
                  </span>
                </span>
              </li>
              
              <li className="flex items-start gap-2.5">
                <span className="text-amber-500 font-extrabold shrink-0 text-xs">✦ Bước 3:</span>
                <span><strong>Không thay đổi mật khẩu/email cấp tốc:</strong> Đổi thông tin bảo mật kết hợp với việc IP thay đổi đột ngột là tín hiệu "Red Flag" kích hoạt khóa tài khoản tức thì. Hãy để tài khoản hoạt động ổn định trên thiết bị tối thiểu <strong>24h - 48h</strong> rồi mới thực hiện thay đổi thông tin.</span>
              </li>
              
              <li className="flex items-start gap-2.5">
                <span className="text-amber-500 font-extrabold shrink-0 text-xs">✦ Bước 4:</span>
                <span><strong>Hành vi giãn cách:</strong> Giữ khoảng cách tối thiểu 10-15 giây giữa các lượt hội thoại trong những phiên chat đầu tiên, tránh copy-paste lượng lớn nội dung dồn dập.</span>
              </li>
            </ul>
            
            <div className="bg-emerald-950/25 border border-emerald-500/10 p-2.5 rounded-lg text-emerald-400 font-bold flex items-center gap-1.5 text-[10px] mt-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>Tuân thủ đúng quy trình làm ấm sẽ nâng cao độ trust của tài khoản lên đến 95% và tránh quét die tự động từ OpenAI!</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
