'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth/auth-client';
import { deleteMyAccount } from '@/server/actions/account';

interface DeleteAccountDialogProps {
  expectedConfirmation: string;
}

export function DeleteAccountDialog({ expectedConfirmation }: DeleteAccountDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const matches = confirmation.trim() === expectedConfirmation.trim();

  async function handleConfirm() {
    if (!matches || submitting) return;
    setSubmitting(true);
    try {
      const result = await deleteMyAccount(confirmation);
      if ('error' in result) {
        toast.error(result.error);
        setSubmitting(false);
        return;
      }
      toast.success('Your account has been deleted.');
      await authClient.signOut();
      router.push('/login');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete account');
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          setOpen(next);
          if (!next) setConfirmation('');
        }
      }}
    >
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete your account
          </DialogTitle>
          <DialogDescription>
            This permanently removes your account, sessions, OAuth links, consent records, and any
            runners you created. If you are the sole member of your team, the team will also be
            deleted. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="confirm-name">
            Type{' '}
            <span className="font-mono font-semibold text-foreground">{expectedConfirmation}</span>{' '}
            to confirm
          </Label>
          <Input
            id="confirm-name"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={expectedConfirmation}
            autoComplete="off"
            disabled={submitting}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!matches || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete my account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
