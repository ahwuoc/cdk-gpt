"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ImageLightbox } from "@/components/image-lightbox";

const steps = [
  {
    title: "1. Đăng nhập ChatGPT",
    description:
      "Mở trình duyệt web, đăng nhập vào tài khoản ChatGPT của bạn và giữ nguyên tab đang đăng nhập đó.",
  },
  {
    title: "2. Lấy dữ liệu Session",
    description:
      "Mở một tab mới, truy cập link https://chatgpt.com/api/auth/session. Bôi đen toàn bộ nội dung hiển thị trên màn hình và copy.",
  },
  {
    title: "3. Chuyển đổi và tải xuống ZIP",
    description:
      "Dùng công cụ import nội bộ đã được cung cấp, dán nội dung session vừa copy và tải file ZIP chứa bộ công cụ nạp tự động.",
  },
  {
    title: "4. Nạp cấu hình tự động vào 9router",
    description:
      "Giải nén file ZIP vừa tải về. Đảm bảo 9router đang TẮT. Chạy file 'Run-Import-Windows.bat' (nếu dùng Windows) hoặc 'Run-Import-Mac-Linux.sh' (nếu dùng Mac/Linux). Các tài khoản sẽ được tự động nạp thẳng vào 9router!",
  },
  {
    title: "5. Mở trang CLI Tools",
    description:
      "Mở app 9router trên máy tính (chạy lệnh 9router start). Chọn mục 'CLI Tools' ở menu bên trái. Tìm và bấm vào hộp 'OpenAI Codex CLI / App'.",
  },
  {
    title: "6. Áp dụng cấu hình tự động",
    description:
      "Nhấn 'Select Model' để chọn model muốn dùng, sau đó nhấn nút 'Apply' màu cam. 9router sẽ tự động cài đặt mọi thứ vào máy bạn!",
  },
];

const stepDescriptions: Record<string, ReactNode> = {
  "2. Lấy dữ liệu Session": (
    <>
      Truy cập{" "}
      <a
        href="https://chatgpt.com/api/auth/session"
        target="_blank"
        rel="noreferrer"
        className="font-extrabold text-amber-600 hover:underline"
      >
        link lấy session
      </a>
      , sau đó <strong>bôi đen toàn bộ</strong> và copy nội dung chữ hiển thị trên màn hình.
    </>
  ),
  "3. Chuyển đổi và tải xuống ZIP": (
    <>
      Dùng công cụ import nội bộ đã được cung cấp, dán đoạn JSON vừa copy vào ô dữ liệu. Sau đó tải file ZIP chứa script chạy tự động.
    </>
  ),
  "4. Nạp cấu hình tự động vào 9router": (
    <>
      Giải nén file ZIP. Đảm bảo bạn <strong>đã tắt ứng dụng 9router</strong>. Nháy đúp vào file <strong>Run-Import-Windows.bat</strong> (với Windows) hoặc chạy lệnh <strong>Run-Import-Mac-Linux.sh</strong> (với Mac/Linux). Tool sẽ tự động đưa cấu hình vào Database.
    </>
  ),
  "5. Mở trang CLI Tools": (
    <>
      Mở ứng dụng 9router chính thức của bạn (chạy lệnh <code>9router start</code>). Nhìn sang thanh menu bên trái, tìm và bấm vào mục <strong>CLI Tools</strong>. Bấm chọn <strong>OpenAI Codex CLI / App</strong>.
    </>
  ),
  "6. Áp dụng cấu hình tự động": (
    <>
      Bấm <strong>Select Model</strong> để chọn loại AI. Sau đó nhấn nút <strong>Apply (Màu cam)</strong>. 9router sẽ tự động ghi đè file cấu hình vào hệ thống của bạn!
    </>
  ),
};

const stepImages: Record<string, { src: string; alt: string }> = {
  "2. Lấy dữ liệu Session": {
    src: "/docs/chatgpt-session.png",
    alt: "Trang JSON Session ChatGPT",
  },
  "3. Chuyển đổi và tải xuống ZIP": {
    src: "/docs/9router-convert-tool.png",
    alt: "Công cụ import session",
  },
  "4. Nạp cấu hình tự động vào 9router": {
    src: "/docs/9router-import-script.png",
    alt: "Chạy file script tự động nạp",
  },
  "5. Mở trang CLI Tools": {
    src: "/docs/9router-cli-tools.png",
    alt: "Trang CLI Tools",
  },
  "6. Áp dụng cấu hình tự động": {
    src: "/docs/9router-apply.png",
    alt: "Nhấn nút Apply màu cam",
  },
};

const notes = [
  "Không gửi session JSON cho người lạ vì có chứa token đăng nhập của bạn.",
  "Nếu session hết hạn (bị lỗi khi dùng), hãy đăng nhập lại ChatGPT rồi lấy session mới và import lại.",
  "Hãy sử dụng nút [Apply] trên ứng dụng để 9router tự động cài đặt thay vì tự copy file cấu hình.",
  "Nên kiểm tra email/tên tài khoản sau khi import để tránh lẫn lộn.",
];

const configTomlExample = `# 9Router Configuration for Codex CLI
model = "cx/gpt-5.5"
model_provider = "9router"

[model_providers.9router]
name = "9Router"
base_url = "http://127.0.0.1:20128/v1"
wire_api = "responses"

[agents.subagent]
model = "cx/gpt-5.5"`;

const authJsonExample = `{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
}`;

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-white px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <nav className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-white/80 px-4 py-3 shadow-sm">
          <Link href="/shop" className="text-lg font-black text-gray-900">
            GPT Shop
          </Link>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <Link href="/shop" className="text-gray-600 hover:text-gray-900">
              Shop
            </Link>
          </div>
        </nav>

        <section className="mb-8 rounded-3xl border border-amber-100 bg-white p-6 shadow-xl shadow-amber-100/40 sm:p-8">
          <p className="mb-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-amber-800">
            Tài liệu hướng dẫn
          </p>
          <h1 className="mb-4 text-3xl font-black tracking-tight text-gray-950 sm:text-5xl">
            Hướng dẫn dùng ChatGPT + 9router
          </h1>
          <p className="max-w-2xl text-base leading-7 text-gray-600">
            Trang này hướng dẫn nhanh cách cấu hình và tự động nạp dữ liệu phiên làm việc vào ứng dụng 9router chính thức để sử dụng các Model AI thả ga.
            <br /><br />
            <strong>Lưu ý:</strong> Vui lòng sử dụng phiên bản 9router chính thức cài đặt qua npm để được cập nhật proxy bypass mới nhất, tránh bị khóa API.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="https://chatgpt.com/api/auth/session"
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-amber-200 bg-white px-5 py-3 text-sm font-extrabold text-amber-800 transition hover:bg-amber-50"
            >
              Mở link lấy session
            </a>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-extrabold text-emerald-800 transition flex items-center">
              <span>Cài 9router qua npm:</span>
              <code
                className="bg-white px-2 py-1 ml-2 rounded text-emerald-900 border border-emerald-200 cursor-pointer hover:bg-emerald-100 active:scale-95 transition"
                onClick={() => { navigator.clipboard.writeText('npm i -g 9router'); alert('Đã copy lệnh!') }}
              >
                npm i -g 9router
              </code>
            </div>
          </div>
        </section>

        <section className="grid gap-4">
          {steps.map((step) => (
            <article key={step.title} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="p-5">
                <h2 className="mb-2 text-lg font-black text-gray-950">{step.title}</h2>
                <p className="leading-7 text-gray-600">{stepDescriptions[step.title] ?? step.description}</p>
              </div>
              {stepImages[step.title] && (
                <ImageLightbox
                  src={stepImages[step.title].src}
                  alt={stepImages[step.title].alt}
                />
              )}
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-emerald-700">
            Dành cho người dùng thủ công
          </p>
          <h2 className="text-2xl font-black text-gray-950">
            Tạo hoặc sửa 2 file cấu hình bằng tay (Nếu không dùng nút Apply)
          </h2>
          <p className="mt-2 leading-7 text-gray-600">
            Nếu nút <strong>Apply</strong> không hoạt động do lỗi quyền truy cập, bạn có thể bấm <strong>Manual Config</strong>, copy nội dung tương ứng vào 2 file dưới đây. Nhớ thay <strong>OPENAI_API_KEY</strong>, <strong>base_url</strong> và <strong>model</strong> theo thông tin 9router hiển thị trên máy bạn.
          </p>

          <div className="mt-5 grid gap-5">
            <article className="overflow-hidden rounded-2xl border border-gray-200">
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                <code className="text-sm font-black text-gray-900">%USERPROFILE%\\.codex\\config.toml</code>
              </div>
              <pre className="overflow-x-auto bg-gray-950 p-4 text-sm leading-6 text-gray-100">
                <code>{configTomlExample}</code>
              </pre>
            </article>

            <article className="overflow-hidden rounded-2xl border border-gray-200">
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                <code className="text-sm font-black text-gray-900">%USERPROFILE%\\.codex\\auth.json</code>
              </div>
              <pre className="overflow-x-auto bg-gray-950 p-4 text-sm leading-6 text-gray-100">
                <code>{authJsonExample}</code>
              </pre>
            </article>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-red-100 bg-red-50/70 p-6">
          <h2 className="mb-4 text-xl font-black text-red-950">Lưu ý bảo mật</h2>
          <ul className="space-y-3 text-sm font-medium leading-6 text-red-900">
            {notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
