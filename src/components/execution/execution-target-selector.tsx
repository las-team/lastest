'use client';

import { useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Monitor, Cloud } from 'lucide-react';
import type { RunnerCapability } from '@/lib/db/schema';
import { useRunnerStatus } from './use-runner-status';
import { persistRunnerPreference } from '@/hooks/use-preferred-runner';

interface ExecutionTargetSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  capabilityFilter?: RunnerCapability;
  size?: 'sm' | 'default';
  className?: string;
}

export function ExecutionTargetSelector({
  value,
  onChange,
  disabled = false,
  capabilityFilter,
  size = 'default',
  className,
}: ExecutionTargetSelectorProps) {
  const { runners, isLoading } = useRunnerStatus(capabilityFilter);

  // If selected runner goes offline, reset to local
  useEffect(() => {
    if (value !== 'local' && !isLoading) {
      const selectedRunner = runners.find((r) => r.id === value);
      if (selectedRunner && selectedRunner.status !== 'online') {
        onChange('local');
      }
    }
  }, [runners, value, isLoading, onChange]);

  return (
    <Select value={value} onValueChange={(v) => { persistRunnerPreference(v); onChange(v); }} disabled={disabled}>
      <SelectTrigger size={size} className={className}>
        <SelectValue placeholder="Select target" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="local">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            <span>Local</span>
          </div>
        </SelectItem>
        {runners.map((runner) => {
          const isOnline = runner.status === 'online';
          return (
            <SelectItem key={runner.id} value={runner.id} disabled={!isOnline}>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Cloud className={`h-4 w-4 ${!isOnline ? 'text-muted-foreground' : ''}`} />
                  <div
                    className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${
                      isOnline ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  />
                </div>
                <span className={!isOnline ? 'text-muted-foreground' : ''}>{runner.name}</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
