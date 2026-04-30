'use client';

import Link from 'next/link';
import Image from 'next/image';
import { RepoSelector, type RepositoryWithTestCount } from './repo-selector';
import type { Repository } from '@/lib/db/schema';

interface MobileTopBarProps {
  repos?: RepositoryWithTestCount[];
  selectedRepo?: Repository | null;
}

export function MobileTopBar({ repos, selectedRepo }: MobileTopBarProps) {
  return (
    <header
      className="md:hidden sticky top-0 z-30 flex items-center gap-2 h-12 px-3 border-b bg-background/95 backdrop-blur"
    >
      <Link href="/" className="flex items-center gap-1.5 font-bold text-sm shrink-0">
        <Image src="/icon-light.svg" alt="" width={22} height={22} className="dark:hidden" />
        <Image src="/icon-dark.svg" alt="" width={22} height={22} className="hidden dark:block" />
      </Link>
      <div className="flex-1 min-w-0">
        <RepoSelector initialRepos={repos} initialSelected={selectedRepo} />
      </div>
    </header>
  );
}
