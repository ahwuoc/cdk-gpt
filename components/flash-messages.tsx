"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useEffect, Suspense } from "react";
import { toast } from "sonner";

function FlashMessagesContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop()?.split(";").shift();
      return null;
    };

    const flashCookie = getCookie("flash_message");
    if (flashCookie) {
      try {
        const { type, message } = JSON.parse(decodeURIComponent(flashCookie));
        if (type === "success") toast.success(message);
        else toast.error(message);

        // Clear cookie
        document.cookie = "flash_message=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      } catch (e) {
        console.error("Flash cookie error:", e);
      }
    }

    if (!searchParams) return;

    // 2. Backward Compatibility: Check URL Search Params
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success || error) {
      if (success) toast.success(decodeURIComponent(success));
      if (error) toast.error(decodeURIComponent(error));

      // Remove the params from the URL immediately
      const url = new URL(window.location.href);
      url.searchParams.delete("success");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [searchParams]);

  return null;
}

export function FlashMessages() {
  return (
    <Suspense fallback={null}>
      <FlashMessagesContent />
    </Suspense>
  );
}
