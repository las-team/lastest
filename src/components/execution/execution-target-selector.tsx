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
import { Cloud, Tv2, Zap, Server } from 'lucide-react';
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

  const teamRunners = runners.filter((r) => r.type !== 'embedded' && !r.isSystem);
  const teamEmbeddedRunners = runners.filter((r) => r.type === 'embedded' && !r.isSystem);
  const systemRunners = runners.filter((r) => r.isSystem);

  // If selected runner goes offline, fallback to auto
  useEffect(() => {
    if (value === 'auto' || isLoading || disabled) return;

    const selectedRunner = runners.find((r) => r.id === value);
    if (selectedRunner && selectedRunner.status !== 'online' && selectedRunner.status !== 'busy') {
      const availableSystem = systemRunners.find((r) => r.status === 'online');
      onChange(availableSystem ? availableSystem.id : 'auto');
    }
  }, [runners, value, isLoading, onChange, systemRunners, disabled]);

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
        {/* Auto option — uses fallback chain (always available as default) */}
        <SelectItem value="auto">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-500" />
            <span>Auto</span>
          </div>
        </SelectItem>

        {/* Team remote runners */}
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

        {/* Team embedded browsers */}
        {teamEmbeddedRunners.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-xs text-muted-foreground">Embedded Browsers</SelectLabel>
            {teamEmbeddedRunners.map((runner) => {
              const isOnline = runner.status === 'online';
              const isBusy = runner.status === 'busy';
              return (
                <SelectItem key={runner.id} value={runner.id} disabled={!isOnline && !isBusy}>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Tv2 className={`h-4 w-4 ${!isOnline && !isBusy ? 'text-muted-foreground' : 'text-purple-500'}`} />
                      <div
                        className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${
                          isOnline ? 'bg-green-500' : isBusy ? 'bg-yellow-500' : 'bg-gray-400'
                        }`}
                      />
                    </div>
                    <span className={!isOnline && !isBusy ? 'text-muted-foreground' : ''}>
                      {runner.name}
                    </span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectGroup>
        )}

        {/* System runners (host-provided EBs) */}
        {systemRunners.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-xs text-muted-foreground">System Browsers</SelectLabel>
            {systemRunners.map((runner) => {
              const isOnline = runner.status === 'online';
              const isBusy = runner.status === 'busy';
              return (
                <SelectItem key={runner.id} value={runner.id} disabled={!isOnline && !isBusy}>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Server className={`h-4 w-4 ${!isOnline && !isBusy ? 'text-muted-foreground' : 'text-blue-500'}`} />
                      <div
                        className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${
                          isOnline ? 'bg-green-500' : isBusy ? 'bg-yellow-500' : 'bg-gray-400'
                        }`}
                      />
                    </div>
                    <span className={!isOnline && !isBusy ? 'text-muted-foreground' : ''}>
                      {runner.name}
                    </span>
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
