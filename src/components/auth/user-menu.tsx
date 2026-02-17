'use client';

import { UserButton, useUser } from '@clerk/nextjs';

export function UserMenu() {
  const { user } = useUser();

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
      {user && (
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {user.fullName || user.primaryEmailAddress?.emailAddress?.split('@')[0]}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {user.primaryEmailAddress?.emailAddress}
          </p>
        </div>
      )}
    </div>
  );
}
