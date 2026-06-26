"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapses the in-product BYOK provider config under an "Advanced" disclosure.
 * MCP is the promoted path; BYOK stays available but out of the way. Opens by
 * default when the team already has BYOK configured so existing setups remain
 * visible.
 */
export function AiAdvancedSettings({
  defaultOpen = false,
  children,
}: {
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-3">
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-4 py-3 text-left text-sm font-medium hover:bg-muted/50">
        <span className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          Advanced: run AI inside Lastest (bring your own key)
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-6">{children}</CollapsibleContent>
    </Collapsible>
  );
}
