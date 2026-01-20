'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { Route } from '@/lib/db/schema';

interface RouteSelectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routes: Route[];
  title: string;
  description: string;
  actionLabel: string;
  onAction: (selectedIds: string[]) => Promise<void>;
}

export function RouteSelectorDialog({
  open,
  onOpenChange,
  routes,
  title,
  description,
  actionLabel,
  onAction,
}: RouteSelectorDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const toggleRoute = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const selectAll = () => {
    setSelectedIds(new Set(routes.map(r => r.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const handleAction = async () => {
    if (selectedIds.size === 0) return;
    setLoading(true);
    try {
      await onAction(Array.from(selectedIds));
      onOpenChange(false);
      setSelectedIds(new Set());
    } finally {
      setLoading(false);
    }
  };

  // Filter to show uncovered routes for test generation
  const availableRoutes = routes.filter(r => !r.hasTest || !r.functionalAreaId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-2">
          <Button variant="outline" size="sm" onClick={selectAll}>
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={selectNone}>
            Select None
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">
            {selectedIds.size} selected
          </span>
        </div>

        <ScrollArea className="h-[300px] border rounded-md p-2">
          {availableRoutes.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              All routes already have tests or areas.
            </div>
          ) : (
            <div className="space-y-1">
              {availableRoutes.map(route => (
                <div
                  key={route.id}
                  onClick={() => toggleRoute(route.id)}
                  className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted ${
                    selectedIds.has(route.id) ? 'bg-primary/10' : ''
                  }`}
                >
                  <div
                    className={`w-4 h-4 border rounded flex items-center justify-center ${
                      selectedIds.has(route.id)
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-input'
                    }`}
                  >
                    {selectedIds.has(route.id) && (
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                  <span className="font-mono text-sm flex-1">{route.path}</span>
                  <Badge variant={route.type === 'dynamic' ? 'secondary' : 'outline'}>
                    {route.type}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAction}
            disabled={selectedIds.size === 0 || loading}
          >
            {loading ? 'Processing...' : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
