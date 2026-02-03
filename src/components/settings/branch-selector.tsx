'use client';

import { useState, useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchRepoBranches, updateRepoSelectedBranch } from '@/server/actions/repos';
import { Loader2 } from 'lucide-react';

interface BranchSelectorProps {
  repositoryId: string;
  currentBranch: string | null;
  defaultBranch: string | null;
}

export function BranchSelector({
  repositoryId,
  currentBranch,
  defaultBranch,
}: BranchSelectorProps) {
  const [branches, setBranches] = useState<{ name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetchRepoBranches(repositoryId)
      .then(setBranches)
      .finally(() => setLoading(false));
  }, [repositoryId]);

  const handleChange = async (value: string) => {
    setUpdating(true);
    await updateRepoSelectedBranch(repositoryId, value);
    setUpdating(false);
  };

  const selectedValue = currentBranch || defaultBranch || '';

  if (loading) {
    return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  }

  return (
    <Select value={selectedValue} onValueChange={handleChange} disabled={updating}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select branch" />
        {updating && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
      </SelectTrigger>
      <SelectContent>
        {branches.map((branch) => (
          <SelectItem key={branch.name} value={branch.name}>
            {branch.name}
            {branch.name === defaultBranch && (
              <span className="text-muted-foreground ml-1">(default)</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
