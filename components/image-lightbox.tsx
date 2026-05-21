"use client";

import { useEffect, useState } from "react";

interface ImageLightboxProps {
  src: string;
  alt: string;
}

export function ImageLightbox({ src, alt }: ImageLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="block w-full border-t border-amber-100 text-left"
        title="Click để xem ảnh phóng to"
      >
        <img
          src={src}
          alt={alt}
          className="w-full cursor-zoom-in transition hover:opacity-95"
        />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Ảnh phóng to"
          onClick={() => setIsOpen(false)}
        >
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white text-2xl font-black text-gray-900 shadow-lg transition hover:bg-gray-100"
            aria-label="Đóng ảnh"
          >
            ×
          </button>
          <img
            src={src}
            alt={alt}
            className="max-h-[90vh] max-w-[95vw] rounded-2xl bg-white object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
