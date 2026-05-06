'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CANCELLATION_REASONS, cancelTeamSubscription } from '@/server/actions/billing';
import { PLANS } from '@/lib/polar/plans';
import type { SubscriptionPlan } from '@/lib/db/schema';

interface CancelSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: SubscriptionPlan;
  periodEndLabel: string;
  onCancelled?: () => void;
}

type Mode = 'period_end' | 'immediate';

export function CancelSubscriptionDialog({
  open,
  onOpenChange,
  currentPlan,
  periodEndLabel,
  onCancelled,
}: CancelSubscriptionDialogProps) {
  const [reason, setReason] = useState<(typeof CANCELLATION_REASONS)[number]['id'] | null>(null);
  const [comment, setComment] = useState('');
  const [mode, setMode] = useState<Mode>('period_end');
  const [pending, startTransition] = useTransition();

  function reset() {
    setReason(null);
    setComment('');
    setMode('period_end');
  }

  function handleSubmit() {
    startTransition(async () => {
      try {
        await cancelTeamSubscription({
          mode,
          reason: reason ?? undefined,
          comment: comment.trim() || undefined,
        });
        toast.success(
          mode === 'immediate'
            ? 'Subscription canceled and access revoked'
            : `Subscription will end on ${periodEndLabel}`,
        );
        reset();
        onOpenChange(false);
        onCancelled?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to cancel subscription');
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Cancel {PLANS[currentPlan].name} subscription
          </DialogTitle>
          <DialogDescription>
            We&apos;d hate to see you go. Tell us what we could do better — feedback goes straight
            to the team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>When should the cancellation take effect?</Label>
            <div className="grid grid-cols-1 gap-2">
              <ModeOption
                selected={mode === 'period_end'}
                onSelect={() => setMode('period_end')}
                title={`At period end (${periodEndLabel})`}
                description="Keep using paid features until your current period ends. You can resume any time before then."
              />
              <ModeOption
                selected={mode === 'immediate'}
                onSelect={() => setMode('immediate')}
                title="Immediately"
                description="Lose access right now. Polar prorates the unused portion of the period."
                destructive
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Why are you cancelling?</Label>
            <div className="grid grid-cols-2 gap-2">
              {CANCELLATION_REASONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={pending}
                  onClick={() => setReason(option.id)}
                  className={`text-left text-sm rounded-md border px-3 py-2 transition-colors ${
                    reason === option.id
                      ? 'border-primary bg-primary/10'
                      : 'border-input hover:bg-muted'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cancel-comment">Anything else? (optional)</Label>
            <Textarea
              id="cancel-comment"
              value={comment}
              maxLength={1000}
              disabled={pending}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What were you hoping to do that we couldn't help with?"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Keep subscription
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'immediate' ? 'Cancel now' : 'Cancel at period end'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeOption({
  selected,
  onSelect,
  title,
  description,
  destructive,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-md border px-3 py-2 transition-colors ${
        selected
          ? destructive
            ? 'border-destructive bg-destructive/10'
            : 'border-primary bg-primary/10'
          : 'border-input hover:bg-muted'
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
    </button>
  );
}
