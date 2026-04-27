'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.749 9.769L21.756 6.71l-1.97-6.063a.339.339 0 00-.642 0L17.176 6.71H6.825L4.857.647a.339.339 0 00-.642 0L2.245 6.71l-.992 3.059a.68.68 0 00.247.762L12 19.292l10.5-8.761a.68.68 0 00.247-.762z" />
    </svg>
  );
}

export function ConnectGitlabButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <GitLabIcon className="w-5 h-5" />
            Connect GitLab
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href="/api/connect/gitlab">gitlab.com (OAuth)</a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            Self-Hosted GitLab…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SelfHostedDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function SelfHostedDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const [tab, setTab] = useState<'pat' | 'oauth'>('pat');
  const [instanceUrl, setInstanceUrl] = useState('https://');
  const [pat, setPat] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitPat = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/connect/gitlab/pat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceUrl: instanceUrl.trim(), pat: pat.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success('GitLab connected');
      onOpenChange(false);
      window.location.href = '/settings?success=gitlab_connected';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setSubmitting(false);
    }
  };

  const submitOAuth = () => {
    // Use a hidden form to POST so clientSecret never lands in the URL.
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/connect/gitlab';
    for (const [k, v] of Object.entries({ instanceUrl: instanceUrl.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() })) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = v;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Self-Hosted GitLab</DialogTitle>
          <DialogDescription>
            Use a Personal Access Token, or register an OAuth app on your GitLab instance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="gl-instance">Instance URL</Label>
            <Input
              id="gl-instance"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              placeholder="https://gitlab.example.com"
            />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'pat' | 'oauth')}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="pat">Personal Access Token</TabsTrigger>
              <TabsTrigger value="oauth">OAuth App</TabsTrigger>
            </TabsList>
            <TabsContent value="pat" className="space-y-2 pt-2">
              <Label htmlFor="gl-pat" className="text-xs">PAT (scopes: api, read_user, read_repository)</Label>
              <Input
                id="gl-pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="glpat-..."
              />
              <p className="text-xs text-muted-foreground">
                Stored encrypted at rest; used in place of OAuth for self-hosted instances.
              </p>
            </TabsContent>
            <TabsContent value="oauth" className="space-y-2 pt-2">
              <Label htmlFor="gl-client-id" className="text-xs">Client ID</Label>
              <Input
                id="gl-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Application ID from GitLab"
              />
              <Label htmlFor="gl-client-secret" className="text-xs">Client Secret</Label>
              <Input
                id="gl-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Application secret"
              />
              <p className="text-xs text-muted-foreground">
                Register the OAuth app at <code>{instanceUrl}/-/profile/applications</code> with redirect URI{' '}
                <code>{typeof window !== 'undefined' ? `${window.location.origin}/api/connect/gitlab/callback` : '/api/connect/gitlab/callback'}</code>.
              </p>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          {tab === 'pat' ? (
            <Button onClick={submitPat} disabled={submitting || !instanceUrl.startsWith('http') || !pat}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Connect via PAT
            </Button>
          ) : (
            <Button onClick={submitOAuth} disabled={!instanceUrl.startsWith('http') || !clientId || !clientSecret}>
              Continue to GitLab
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
