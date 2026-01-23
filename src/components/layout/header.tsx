'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Video, Play, Settings, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { createAndRunBuild } from '@/server/actions/builds';
import { QueueIndicator } from '@/components/queue/queue-indicator';

interface HeaderProps {
  title?: string;
}

export function Header({ title = 'Dashboard' }: HeaderProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);

  const handleRunAll = async () => {
    setIsRunning(true);
    try {
      const { buildId } = await createAndRunBuild('manual');
      router.push(`/builds/${buildId}`);
    } catch (error) {
      console.error('Failed to start build:', error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <header className="h-14 border-b flex items-center justify-between px-6">
      <h1 className="text-lg font-semibold">{title}</h1>

      <div className="flex items-center gap-2">
        <QueueIndicator />
        <Button asChild variant="outline" size="sm">
          <Link href="/record">
            <Video className="h-4 w-4 mr-2" />
            Record Test
          </Link>
        </Button>

        <Button size="sm" onClick={handleRunAll} disabled={isRunning}>
          {isRunning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Run All
        </Button>

        <Button asChild variant="ghost" size="icon">
          <Link href="/settings">
            <Settings className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </header>
  );
}
