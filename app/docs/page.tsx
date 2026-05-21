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
      "Mở một tab mới, truy cập link https://chatgpt.com/api/auth/session. Bôi đen và copy toàn bộ nội dung chữ (JSON) hiển thị trên màn hình.",
  },
  {
    title: "3. Chuyển đổi định dạng tại 9router Tool",
    description:
      "Mở trang 9router Tool trên web của chúng tôi, dán nội dung vừa copy vào ô dữ liệu. Nhấn nút chuyển đổi và tải về file JSON chứa danh sách tài khoản.",
  },
  {
    title: "4. Mở app 9router (Bản Fork)",
    description:
      "Mở phần mềm 9router mà bạn đã tải về cài đặt trên máy. Chờ cho đến khi giao diện Dashboard hiện lên trên trình duyệt (thường ở địa chỉ localhost:20128).",
  },
  {
    title: "5. Import tự động vào 9router",
    description:
      "Trong giao diện 9router, ở thanh menu bên trái, chọn 'Providers' -> Bấm vào 'OpenAI Codex'. Tại đây, hãy tìm và nhấn nút 'Import JSON', sau đó chọn file JSON mà bạn đã tải về ở Bước 3. Tài khoản sẽ tự động được thêm vào hệ thống!",
  },
  {
    title: "6. Áp dụng cấu hình (Apply / Manual Config)",
    description:
      "Sau khi Import, ngay tại trang OpenAI Codex đó: chọn 'Endpoint' và 'Model' tương ứng, sau đó nhấn nút 'Apply' để phần mềm TỰ ĐỘNG cập nhật cấu hình vào máy bạn. Hoặc bạn có thể bấm 'Manual Config' để tự xem và copy.",
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
      , sau đó <strong>bôi đen toàn bộ</strong> và copy nội dung JSON hiển thị trên màn hình (Ctrl+A rồi Ctrl+C).
    </>
  ),
  "3. Chuyển đổi định dạng tại 9router Tool": (
    <>
      Mở trang{" "}
      <Link href="/convert" className="font-extrabold text-emerald-600 hover:underline">
        9router Tool
      </Link>
      , dán đoạn JSON vừa copy vào ô. Bấm chuyển đổi để lấy ra file chuẩn của 9router.
    </>
  ),
  "5. Import tự động vào 9router": (
    <>
      Vào mục <strong>Providers</strong> &gt; <strong>OpenAI Codex</strong>. Nhấn nút <strong>Import JSON</strong> (Nút có biểu tượng tệp tin tải lên) và chọn file bạn vừa tạo.
    </>
  ),
  "6. Áp dụng cấu hình (Apply / Manual Config)": (
    <>
      Chọn cấu hình (Model, Endpoint) và nhấn nút <strong>Apply (Màu cam)</strong>. 9router sẽ tự động ghi đè file cấu hình hệ thống của bạn! Không cần làm thủ công nữa.
    </>
  ),
};

const stepImages: Record<string, { src: string; alt: string }> = {
  "2. Lấy dữ liệu Session": {
    src: "/docs/chatgpt-session-example.png",
    alt: "Minh hoạ trang ChatGPT session dùng dữ liệu mẫu",
  },
  "3. Chuyển đổi định dạng tại 9router Tool": {
    src: "/docs/9router-tool-convert.png",
    alt: "Minh hoạ trang 9router Tool dán session và tạo ZIP import",
  },
  "5. Import tự động vào 9router": {
    src: "/docs/9router-import-btn.png",
    alt: "Vị trí nút Import JSON trong ứng dụng 9router",
  },
  "6. Áp dụng cấu hình (Apply / Manual Config)": {
    src: "/docs/9router-manual-config.png",
    alt: "Hướng dẫn click Apply hoặc Manual Config",
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
            <Link href="/convert" className="text-emerald-600 hover:text-emerald-700">
              9router Tool
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
            Trang này hướng dẫn nhanh cách lấy dữ liệu session từ ChatGPT, chuyển đổi sang định dạng 9router và import bằng bộ công cụ offline.
            <br /><br />
            <strong>Lưu ý:</strong> Đây là bản 9router đã được fork và bổ sung thêm chức năng. Bạn có thể tải bản cài đặt mới nhất bên dưới.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/convert"
              className="rounded-2xl bg-amber-600 px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-amber-200 transition hover:bg-amber-500"
            >
              Mở 9router Tool
            </Link>
            <a
              href="https://chatgpt.com/api/auth/session"
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-amber-200 bg-white px-5 py-3 text-sm font-extrabold text-amber-800 transition hover:bg-amber-50"
            >
              Mở link lấy session
            </a>
            <a
              href="https://github.com/ahwuoc/fork-9router/releases/latest"
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-extrabold text-emerald-800 transition hover:bg-emerald-100"
            >
              Tải 9router (Bản Fork)
            </a>
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
                <code className="text-sm font-black text-gray-900">%USERPROFILE%\.codex\config.toml</code>
              </div>
              <pre className="overflow-x-auto bg-gray-950 p-4 text-sm leading-6 text-gray-100">
                <code>{configTomlExample}</code>
              </pre>
            </article>

            <article className="overflow-hidden rounded-2xl border border-gray-200">
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                <code className="text-sm font-black text-gray-900">%USERPROFILE%\.codex\auth.json</code>
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
