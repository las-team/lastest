'use client';

import { UserButton } from '@clerk/nextjs';

export function UserMenu() {
  return (
    <div className="flex items-center gap-3 w-full p-2">
      <UserButton
        afterSignOutUrl="/login"
        appearance={{
          elements: {
            avatarBox: 'h-8 w-8',
          },
        }}
      />
    </div>
  );
}
