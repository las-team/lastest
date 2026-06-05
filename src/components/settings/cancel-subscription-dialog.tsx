'use client';

import { useTransition } from 'react';
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
import { cancelTeamSubscription } from '@/server/actions/billing';

interface CancelSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planName: string;
  /** Pretty-formatted period end date, e.g. "Jan 5, 2027". Empty if no end. */
  periodEndLabel: string;
}

/**
 * One-tap cancel. No reason picker, no comment box, no immediate-vs-period-end
 * radio — cancellation happens at period end via the Stripe customer portal.
 * The user keeps access until `periodEndLabel`.
 */
export function CancelSubscriptionDialog({
  open,
  onOpenChange,
  planName,
  periodEndLabel,
}: CancelSubscriptionDialogProps) {
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      try {
        const result = await cancelTeamSubscription();
        if (result.url) {
          // Plugin returned a Stripe portal URL — navigate so the
          // user confirms there. Stripe webhook flips
          // cancelAtPeriodEnd on return.
          window.location.assign(result.url);
          return;
        }
        toast.success(
          periodEndLabel
            ? `Subscription will end on ${periodEndLabel}`
            : 'Subscription will end at period end',
        );
        onOpenChange(false);
        window.location.reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to cancel');
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Cancel {planName} subscription?
          </DialogTitle>
          <DialogDescription>
            {periodEndLabel
              ? `You'll keep access until ${periodEndLabel}, then drop to the Free plan. You can resume anytime before then.`
              : `You'll keep access until the end of the current billing period, then drop to the Free plan. You can resume anytime before then.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep subscription
          </Button>
          <Button variant="default" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Cancel subscription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
