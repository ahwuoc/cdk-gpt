'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return <button type="button" onClick={() => void copy()} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-indigo-400 hover:text-white">
    <Copy size={14} className="mr-1 inline" /> {copied ? 'Đã sao chép' : 'Sao chép'}
  </button>;
}
