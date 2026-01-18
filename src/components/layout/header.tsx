'use client';

import { Button } from '@/components/ui/button';
import { Video, Play, Settings } from 'lucide-react';
import Link from 'next/link';

interface HeaderProps {
  title?: string;
}

export function Header({ title = 'Dashboard' }: HeaderProps) {
  return (
    <header className="h-14 border-b flex items-center justify-between px-6">
      <h1 className="text-lg font-semibold">{title}</h1>

      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/record">
            <Video className="h-4 w-4 mr-2" />
            Record Test
          </Link>
        </Button>

        <Button asChild size="sm">
          <Link href="/run">
            <Play className="h-4 w-4 mr-2" />
            Run All
          </Link>
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
