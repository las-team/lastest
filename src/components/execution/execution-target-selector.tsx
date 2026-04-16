'use client';

import { useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Cloud, Zap } from 'lucide-react';
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

  // Only show team remote runners — EBs are pool-managed (auto-assigned)
  const teamRunners = runners.filter((r) => r.type !== 'embedded' && !r.isSystem);

  // If selected value is an EB or system runner, reset to 'auto' (pool handles EBs)
  useEffect(() => {
    if (value === 'auto' || value === 'local' || isLoading || disabled) return;

    const selectedRunner = runners.find((r) => r.id === value);
    // Redirect EB/system selections to auto (pool-managed)
    if (selectedRunner && (selectedRunner.type === 'embedded' || selectedRunner.isSystem)) {
      persistRunnerPreference('auto');
      onChange('auto');
      return;
    }
    // If selected team runner goes offline, fallback to auto
    if (selectedRunner && selectedRunner.status !== 'online' && selectedRunner.status !== 'busy') {
      onChange('auto');
    }
  }, [runners, value, isLoading, onChange, disabled]);

  // If current value is 'local', switch to 'auto'
  useEffect(() => {
    if (value === 'local') {
      onChange('auto');
    }
  }, [value, onChange]);

  return (
    <Select value={value} onValueChange={(v) => { persistRunnerPreference(v); onChange(v); }} disabled={disabled}>
      <SelectTrigger size={size} className={className}>
        <SelectValue placeholder="Select target" />
      </SelectTrigger>
      <SelectContent>
        {/* Auto option — uses fallback chain with pool-managed EBs */}
        <SelectItem value="auto">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-500" />
            <span>Auto</span>
          </div>
        </SelectItem>

        {/* Team remote runners (non-EB, non-system) */}
        {teamRunners.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-xs text-muted-foreground">Remote Runners</SelectLabel>
            {teamRunners.map((runner) => {
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
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
