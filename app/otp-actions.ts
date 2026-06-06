"use server";

import { findAccountByEmail } from "@/lib/accounts";

export async function getOtpPublicAction(
  email: string,
  pass: string,
  refreshToken: string,
  clientId: string
) {
  if (!email || !email.trim()) {
    return { success: false, message: "Vui lòng nhập địa chỉ Email" };
  }
  if (!pass || !pass.trim()) {
    return { success: false, message: "Vui lòng nhập Mật khẩu" };
  }

  try {
    let effectiveRefreshToken = refreshToken.trim();
    let effectiveClientId = clientId.trim();

    if (!effectiveRefreshToken || !effectiveClientId) {
      const account = await findAccountByEmail(email);
      if (!account) {
        return { success: false, message: "Không tìm thấy tài khoản trong DB để tự lấy token." };
      }
      if (account.password && account.password !== pass.trim()) {
        return { success: false, message: "Mật khẩu không khớp với tài khoản trong DB." };
      }

      effectiveRefreshToken = account.sessionToken || "";
      effectiveClientId = account.accountId || "";
    }

    if (!effectiveRefreshToken) {
      return { success: false, message: "Tài khoản trong DB chưa có Refresh Token." };
    }
    if (!effectiveClientId) {
      return { success: false, message: "Tài khoản trong DB chưa có Client ID." };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch("https://tools.dongvanfb.net/api/get_messages_oauth2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        pass: pass.trim(),
        refresh_token: effectiveRefreshToken,
        client_id: effectiveClientId,
        list_mail: "all",
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    if (data.status === true && data.messages) {
      return {
        success: true,
        messages: data.messages.map((msg: any) => {
          let otp = msg.code || "";
          if (otp === "") {
            const matches = msg.message?.match(/>\s*(\d{6})\s*<\/p>/) || msg.message?.match(/[^#](\d{6})/);
            otp = matches ? (matches[1] || matches[0].trim()) : null;
            if (otp) otp = otp.toString().match(/\d{6}/)?.[0] || null;
          }
          return { ...msg, otp };
        }),
      };
    }
    return { success: false, message: data.message || "Không có tin nhắn mới hoặc tài khoản sai thông tin." };
  } catch (error: any) {
    console.error("Public CheckMail error:", error);
    if (error.name === "AbortError") {
      return { success: false, message: "Lỗi: API phản hồi quá chậm (Timeout 20s)" };
    }
    return { success: false, message: `Lỗi kết nối: ${error.message}` };
  }
}
