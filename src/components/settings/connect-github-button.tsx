import { Button } from '@/components/ui/button';
import { Github } from 'lucide-react';
import Link from 'next/link';

export function ConnectGithubButton() {
  return (
    <Button variant="outline" asChild>
      <Link href="/api/connect/github">
        <Github className="w-5 h-5" />
        Connect GitHub
      </Link>
    </Button>
  );
}

export function ReconnectGithubLink() {
  return (
    <Link
      href="/api/connect/github"
      className="text-sm text-primary hover:underline"
    >
      Reconnect
    </Link>
  );
}
