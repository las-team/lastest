'use client';

import { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Monitor, Cloud } from 'lucide-react';
import type { Agent, AgentCapability } from '@/lib/db/schema';
import { getOnlineAgentsWithCapability } from '@/server/actions/agents';

interface ExecutionTargetSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  capabilityFilter?: AgentCapability;
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadAgents() {
      try {
        const onlineAgents = await getOnlineAgentsWithCapability(capabilityFilter);
        setAgents(onlineAgents);
      } catch (error) {
        console.error('Failed to load agents:', error);
        setAgents([]);
      } finally {
        setIsLoading(false);
      }
    }

    loadAgents();
    // Refresh agents periodically
    const interval = setInterval(loadAgents, 30000);
    return () => clearInterval(interval);
  }, [capabilityFilter]);

  // If selected agent goes offline, reset to local
  useEffect(() => {
    if (value !== 'local' && !isLoading) {
      const selectedAgent = agents.find((a) => a.id === value);
      if (!selectedAgent) {
        onChange('local');
      }
    }
  }, [agents, value, isLoading, onChange]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
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
        {agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id}>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Cloud className="h-4 w-4" />
                <div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500" />
              </div>
              <span>{agent.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
