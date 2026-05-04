'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Play, Sparkles, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

interface MobileBottomNavProps {
  sidebar: React.ReactNode;
}

const TABS = [
  { name: 'Run', href: '/run', icon: Play, match: (p: string) => p === '/run' || p.startsWith('/run/') },
  { name: 'Review', href: '/review', icon: Sparkles, match: (p: string) => p === '/review' || p.startsWith('/review/') || p.startsWith('/builds/') },
] as const;

export function MobileBottomNav({ sidebar }: MobileBottomNavProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav
        className={cn(
          'md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t bg-background/95 backdrop-blur',
          'h-14 pb-[env(safe-area-inset-bottom)]'
        )}
      >
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <tab.icon className="h-5 w-5" />
              {tab.name}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
          More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="left" className="p-0 w-[min(85vw,20rem)] overflow-y-auto">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div onClick={() => setMoreOpen(false)} className="h-full">
            {sidebar}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
