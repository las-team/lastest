'use client';

import { authClient } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Github } from 'lucide-react';

export function ConnectGithubButton() {
  return (
    <Button
      variant="outline"
      onClick={() => authClient.signIn.social({ provider: 'github', callbackURL: '/settings?success=github_connected' })}
    >
      <Github className="w-5 h-5" />
      Connect GitHub
    </Button>
  );
}

export function ReconnectGithubLink() {
  return (
    <button
      onClick={() => authClient.signIn.social({ provider: 'github', callbackURL: '/settings?success=github_connected' })}
      className="text-sm text-primary hover:underline cursor-pointer"
    >
      Reconnect
    </button>
  );
}
