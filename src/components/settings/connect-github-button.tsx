'use client';

import { Button } from '@/components/ui/button';
import { Github } from 'lucide-react';
import { authClient } from '@/lib/auth/auth-client';

export function ConnectGithubButton() {
  return (
    <Button
      variant="outline"
      onClick={() => authClient.signIn.social({ provider: 'github', callbackURL: '/settings' })}
    >
      <Github className="w-5 h-5" />
      Connect GitHub
    </Button>
  );
}

export function ReconnectGithubLink() {
  return (
    <button
      onClick={() => authClient.signIn.social({ provider: 'github', callbackURL: '/settings' })}
      className="text-sm text-primary hover:underline"
    >
      Reconnect
    </button>
  );
}
