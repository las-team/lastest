"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

export function EmbedCodeBlock({
  code,
  label,
}: {
  code: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(`${label ?? "Code"} copied`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="relative w-full">
      {label && (
        <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground mb-1.5">
          {label}
        </div>
      )}
      <pre className="m-0 rounded-sm bg-muted text-foreground/90 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all overflow-hidden border border-border/60">
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label ?? "code"}`}
        className="absolute top-0 right-0 mt-[18px] mr-2 inline-flex items-center gap-1.5 rounded-sm border border-border/60 bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground/80 hover:bg-background hover:text-foreground transition"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-600" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
