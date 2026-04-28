'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Variable } from 'lucide-react';
import type { TestVariable } from '@/lib/db/schema';

interface VarReferenceInserterProps {
  variables: TestVariable[];
  onInsert: (reference: string) => void;
}

export function VarReferenceInserter({ variables, onInsert }: VarReferenceInserterProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string>('');

  const assignVars = variables.filter(v => v.mode === 'assign');
  if (assignVars.length === 0) return null;

  const handleInsert = () => {
    if (!name) return;
    onInsert(`{{var:${name}}}`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Variable className="h-4 w-4 mr-1.5" />
          Insert var
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Insert variable reference</DialogTitle>
          <DialogDescription>
            Pick an assign-mode variable. The token <code>{'{{var:name}}'}</code> will be inserted at the end of the editor and resolved at run time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Variable</Label>
            <Select value={name} onValueChange={setName}>
              <SelectTrigger><SelectValue placeholder="Pick a variable" /></SelectTrigger>
              <SelectContent>
                {assignVars.map(v => (
                  <SelectItem key={v.id} value={v.name}>
                    {v.name} <span className="text-muted-foreground ml-2 text-xs">
                      {v.sourceType === 'static'
                        ? `static: ${v.staticValue ?? ''}`
                        : `${v.sourceType}:${v.sourceAlias}.${v.sourceColumn}[${v.sourceRow ?? 0}]`}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleInsert} disabled={!name}>Insert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
