"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { updateQuickstartEmailTemplate } from "@/server/actions/settings";

interface QuickstartEmailTemplateInputProps {
  initial: string;
}

export function QuickstartEmailTemplateInput({
  initial,
}: QuickstartEmailTemplateInputProps) {
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const dirty = value.trim() !== initial.trim();

  function handleSave() {
    startTransition(async () => {
      try {
        await updateQuickstartEmailTemplate(value);
        toast.success("QuickStart email template saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">
        QuickStart demo email template
      </span>
      <p className="text-xs text-muted-foreground/70">
        Used by the QuickStart agent when registering demo users. Must contain
        <code className="mx-1">{"{slug}"}</code> and
        <code className="mx-1">{"{stamp}"}</code> tokens (e.g.{" "}
        <code>viktor+&#123;slug&#125;&#123;stamp&#125;@lastest.cloud</code>).
      </p>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="viktor+{slug}{stamp}@lastest.cloud"
          spellCheck={false}
          autoComplete="off"
        />
        <Button onClick={handleSave} disabled={!dirty || isPending} size="sm">
          Save
        </Button>
      </div>
    </div>
  );
}
