"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

/**
 * Copy a `credentials.<name>.<field>` reference to the clipboard.
 *
 * This small control is the piece that makes credentials easy to use: there is
 * no token grammar to learn (deliberately — credentials never travel the
 * `{{var:…}}` substitution path), so the user should never have to recall the
 * shape of the reference. Shared by the Setup editor, the Setup list and the
 * read-only section on a test's Variables tab.
 */
export function CopyReference({
  reference,
  className,
}: {
  reference: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      title={`Copy ${reference}`}
      aria-label={`Copy ${reference}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(reference);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy to clipboard");
        }
      }}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-600" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </Button>
  );
}
