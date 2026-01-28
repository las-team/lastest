'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createSuite, updateSuite } from '@/server/actions/suites';
import type { Suite } from '@/lib/db/schema';

interface CreateSuiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId?: string;
  editSuite?: Suite;
}

export function CreateSuiteDialog({
  open,
  onOpenChange,
  repositoryId,
  editSuite,
}: CreateSuiteDialogProps) {
  const router = useRouter();
  const [name, setName] = useState(editSuite?.name ?? '');
  const [description, setDescription] = useState(editSuite?.description ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = !!editSuite;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      if (isEditing) {
        await updateSuite(editSuite.id, { name, description: description || undefined });
      } else {
        const suite = await createSuite({
          name,
          description: description || undefined,
          repositoryId,
        });
        router.push(`/suites/${suite.id}`);
      }
      onOpenChange(false);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setName(editSuite?.name ?? '');
      setDescription(editSuite?.description ?? '');
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Suite' : 'Create Suite'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Smoke Tests, Critical Path"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What tests does this suite contain?"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
