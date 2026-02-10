'use client';

import { useState, useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { applyTestingTemplate } from '@/server/actions/repos';
import { TESTING_TEMPLATES, TESTING_TEMPLATE_IDS, type TestingTemplateId } from '@/lib/templates/testing-templates';

interface TestingTemplateSelectorProps {
  repositoryId: string;
  currentTemplate: string | null;
}

export function TestingTemplateSelector({ repositoryId, currentTemplate }: TestingTemplateSelectorProps) {
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSelect(value: string) {
    if (value === 'custom') {
      // Clear template without confirmation
      startTransition(async () => {
        const result = await applyTestingTemplate(repositoryId, null);
        if (result.success) {
          toast.success('Template cleared');
        } else {
          toast.error(result.error || 'Failed to clear template');
        }
      });
      return;
    }
    setPendingTemplate(value);
  }

  function handleConfirm() {
    if (!pendingTemplate) return;
    const templateId = pendingTemplate;
    setPendingTemplate(null);
    startTransition(async () => {
      const result = await applyTestingTemplate(repositoryId, templateId);
      if (result.success) {
        const name = TESTING_TEMPLATES[templateId as Exclude<TestingTemplateId, 'custom'>]?.name ?? templateId;
        toast.success(`Applied "${name}" template`);
      } else {
        toast.error(result.error || 'Failed to apply template');
      }
    });
  }

  const pendingName = pendingTemplate && pendingTemplate !== 'custom'
    ? TESTING_TEMPLATES[pendingTemplate as Exclude<TestingTemplateId, 'custom'>]?.name
    : null;

  return (
    <>
      <Select
        value={currentTemplate ?? 'custom'}
        onValueChange={handleSelect}
        disabled={isPending}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TESTING_TEMPLATE_IDS.map((id) => {
            if (id === 'custom') {
              return (
                <SelectItem key={id} value="custom">
                  Custom
                </SelectItem>
              );
            }
            const t = TESTING_TEMPLATES[id];
            return (
              <SelectItem key={id} value={id}>
                {t.name}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Dialog open={!!pendingTemplate} onOpenChange={(open) => { if (!open) setPendingTemplate(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply Template</DialogTitle>
            <DialogDescription>
              Apply &ldquo;{pendingName}&rdquo;? This will overwrite your current Playwright settings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTemplate(null)}>Cancel</Button>
            <Button onClick={handleConfirm}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
