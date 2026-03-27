'use client';

import { useState } from 'react';
import { FlaskConical, FileCode, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface ExtraStep {
  stepType: 'test' | 'script';
  testId?: string;
  scriptId?: string;
  name: string;
}

interface RecordingSetupPickerProps {
  defaultSteps: { id: string; stepType: 'test' | 'script'; testId?: string | null; scriptId?: string | null; name: string }[];
  extraSteps: ExtraStep[];
  skippedDefaultStepIds: Set<string>;
  availableTests: { id: string; name: string }[];
  availableScripts: { id: string; name: string }[];
  onChange: (steps: ExtraStep[]) => void;
  onSkipChange: (skipped: Set<string>) => void;
}

export function RecordingSetupPicker({
  defaultSteps,
  extraSteps,
  skippedDefaultStepIds,
  availableTests,
  availableScripts,
  onChange,
  onSkipChange,
}: RecordingSetupPickerProps) {
  const [addStepType, setAddStepType] = useState<'test' | 'script'>('test');

  const handleAdd = (itemId: string) => {
    if (addStepType === 'test') {
      const test = availableTests.find((t) => t.id === itemId);
      if (!test) return;
      onChange([...extraSteps, { stepType: 'test', testId: itemId, name: test.name }]);
    } else {
      const script = availableScripts.find((s) => s.id === itemId);
      if (!script) return;
      onChange([...extraSteps, { stepType: 'script', scriptId: itemId, name: script.name }]);
    }
  };

  const handleRemove = (index: number) => {
    onChange(extraSteps.filter((_, i) => i !== index));
  };

  const activeDefaults = defaultSteps.filter((s) => !skippedDefaultStepIds.has(s.id));
  const usedTestIds = new Set([
    ...activeDefaults.filter((s) => s.stepType === 'test' && s.testId).map((s) => s.testId!),
    ...extraSteps.filter((s) => s.stepType === 'test').map((s) => s.testId!),
  ]);
  const usedScriptIds = new Set([
    ...activeDefaults.filter((s) => s.stepType === 'script' && s.scriptId).map((s) => s.scriptId!),
    ...extraSteps.filter((s) => s.stepType === 'script').map((s) => s.scriptId!),
  ]);
  const pickableTests = availableTests.filter((t) => !usedTestIds.has(t.id));
  const pickableScripts = availableScripts.filter((s) => !usedScriptIds.has(s.id));

  return (
    <div className="space-y-2 pt-2">
      {/* Default steps (toggleable) */}
      {defaultSteps.map((step) => {
        const isSkipped = skippedDefaultStepIds.has(step.id);
        const Icon = step.stepType === 'test' ? FlaskConical : FileCode;
        const iconColor = step.stepType === 'test' ? 'text-blue-500' : 'text-green-500';
        const bgColor = step.stepType === 'test' ? 'bg-blue-500/10' : 'bg-green-500/10';
        return (
          <div key={step.id} className={cn('flex items-center gap-3 p-2.5 bg-background/50 border rounded-lg transition-opacity', isSkipped && 'opacity-50')}>
            <div className={cn('flex items-center justify-center w-6 h-6 rounded', bgColor)}>
              <Icon className={cn('w-3.5 h-3.5', iconColor)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn('text-xs font-medium truncate', isSkipped && 'line-through')}>{step.name}</p>
              <p className="text-xs text-muted-foreground">Default</p>
            </div>
            <Switch
              checked={!isSkipped}
              onCheckedChange={(checked) => {
                const next = new Set(skippedDefaultStepIds);
                if (checked) {
                  next.delete(step.id);
                } else {
                  next.add(step.id);
                }
                onSkipChange(next);
              }}
            />
          </div>
        );
      })}

      {/* Extra steps */}
      {extraSteps.map((step, i) => {
        const Icon = step.stepType === 'test' ? FlaskConical : FileCode;
        const iconColor = step.stepType === 'test' ? 'text-blue-500' : 'text-green-500';
        const bgColor = step.stepType === 'test' ? 'bg-blue-500/10' : 'bg-green-500/10';
        return (
          <div key={i} className="flex items-center gap-3 p-2.5 bg-background/80 border rounded-lg">
            <div className={cn('flex items-center justify-center w-6 h-6 rounded', bgColor)}>
              <Icon className={cn('w-3.5 h-3.5', iconColor)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{step.name}</p>
              <p className="text-xs text-muted-foreground">Extra {step.stepType}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => handleRemove(i)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        );
      })}

      {/* Add step row */}
      <div className="flex gap-2 items-center pt-1">
        <Select value={addStepType} onValueChange={(v) => setAddStepType(v as 'test' | 'script')}>
          <SelectTrigger className="w-[100px] h-8 text-xs bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
            <SelectItem value="script">Script</SelectItem>
          </SelectContent>
        </Select>

        <Select onValueChange={handleAdd} value="">
          <SelectTrigger className="flex-1 h-8 text-xs bg-background">
            <SelectValue placeholder="Add extra step..." />
          </SelectTrigger>
          <SelectContent>
            {addStepType === 'test' ? (
              pickableTests.length > 0 ? (
                pickableTests.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <FlaskConical className="w-3.5 h-3.5 text-blue-500" />
                      {t.name}
                    </div>
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="_none" disabled>No tests available</SelectItem>
              )
            ) : pickableScripts.length > 0 ? (
              pickableScripts.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <div className="flex items-center gap-2">
                    <FileCode className="w-3.5 h-3.5 text-green-500" />
                    {s.name}
                  </div>
                </SelectItem>
              ))
            ) : (
              <SelectItem value="_none" disabled>No scripts available</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
