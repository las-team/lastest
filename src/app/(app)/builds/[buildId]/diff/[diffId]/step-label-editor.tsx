'use client';

import { useState, useTransition, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { updateStepLabelAndRediff } from '@/server/actions/diffs';

interface StepLabelEditorProps {
  diffId: string;
  testId: string;
  currentStepLabel: string | null;
  suggestions: string[];
}

export function StepLabelEditor({ diffId, currentStepLabel, suggestions }: StepLabelEditorProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentStepLabel ?? '');
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const filtered = useMemo(() => {
    if (!value.trim()) return suggestions;
    const lower = value.toLowerCase();
    return suggestions.filter(s => s.toLowerCase().includes(lower));
  }, [value, suggestions]);

  const handleSubmit = () => {
    const newLabel = value.trim() || null;
    if ((currentStepLabel ?? null) === newLabel) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await updateStepLabelAndRediff(diffId, newLabel);
      setOpen(false);
      router.refresh();
    });
  };

  const handleSelect = (label: string) => {
    setValue(label);
    if ((currentStepLabel ?? null) === label) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await updateStepLabelAndRediff(diffId, label);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(currentStepLabel ?? ''); }}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 text-muted-foreground font-normal text-base group hover:text-foreground transition-colors">
          &rsaquo;{' '}
          {currentStepLabel ? (
            <span>{currentStepLabel}</span>
          ) : (
            <span className="italic">(no step name)</span>
          )}
          {currentStepLabel ? (
            <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          ) : (
            <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Step Label</label>
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder="Enter step label..."
            disabled={isPending}
            autoFocus
          />
          {filtered.length > 0 && (
            <div className="max-h-40 overflow-y-auto border rounded-md">
              {filtered.map((label) => (
                <button
                  key={label}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors disabled:opacity-50"
                  onClick={() => handleSelect(label)}
                  disabled={isPending}
                >
                  {label}
                  {label === currentStepLabel && (
                    <span className="text-xs text-muted-foreground ml-1">(current)</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            className="w-full"
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Re-diffing...
              </>
            ) : (
              'Save & Re-diff'
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
