'use client';

import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, Settings, Users } from 'lucide-react';
import type { User } from '@/lib/db/schema';

interface UserMenuProps {
  user: User;
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const initials = getInitials(user.name, user.email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-3 w-full p-2 rounded-md hover:bg-muted transition-colors outline-none">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name || user.email}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
            {initials}
          </div>
        )}
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-medium truncate">
            {user.name || user.email.split('@')[0]}
          </p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{user.name || 'User'}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => router.push('/settings')}>
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </DropdownMenuItem>

        {user.role === 'admin' && (
          <DropdownMenuItem onClick={() => router.push('/settings/users')}>
            <Users className="h-4 w-4 mr-2" />
            User Management
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
