"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ApiTestDefinition,
  FunctionalArea,
  LoadTestConfig,
} from "@/lib/db/schema";
import { ApiTestForm } from "./api-test-form";

interface ApiTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  areas: FunctionalArea[];
  /** When editing, the existing test id + initial values. */
  testId?: string;
  initialName?: string;
  initialDefinition?: ApiTestDefinition;
  initialLoadConfig?: LoadTestConfig | null;
  initialAreaId?: string | null;
  onSaved?: (testId: string) => void;
}

export function ApiTestDialog({
  open,
  onOpenChange,
  repositoryId,
  areas,
  testId,
  initialName,
  initialDefinition,
  initialLoadConfig,
  initialAreaId,
  onSaved,
}: ApiTestDialogProps) {
  const editing = !!testId;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit API test" : "New API test"}
          </DialogTitle>
          <DialogDescription>
            A headless HTTP request graded against response assertions — no
            browser. Runs in the same build pipeline as browser tests.
          </DialogDescription>
        </DialogHeader>

        <ApiTestForm
          repositoryId={repositoryId}
          areas={areas}
          testId={testId}
          initialName={initialName}
          initialDefinition={initialDefinition}
          initialLoadConfig={initialLoadConfig}
          initialAreaId={initialAreaId}
          onSaved={(id) => {
            onSaved?.(id);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
