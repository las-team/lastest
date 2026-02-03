'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { X, RefreshCw } from 'lucide-react';
import { cancelInvitation, resendInvitation } from '@/server/actions/users';
import type { UserInvitation } from '@/lib/db/schema';

interface PendingInvitationsProps {
  invitations: UserInvitation[];
}

function getRoleBadge(role: string) {
  const colors: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    member: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    viewer: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[role] || colors.member}`}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

export function PendingInvitations({ invitations }: PendingInvitationsProps) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  if (invitations.length === 0) {
    return null;
  }

  const handleCancel = async (id: string) => {
    setLoadingId(id);
    try {
      await cancelInvitation(id);
      router.refresh();
    } catch (error) {
      console.error('Failed to cancel invitation:', error);
    } finally {
      setLoadingId(null);
    }
  };

  const handleResend = async (id: string) => {
    setLoadingId(id);
    try {
      await resendInvitation(id);
      router.refresh();
    } catch (error) {
      console.error('Failed to resend invitation:', error);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium">Email</th>
            <th className="px-4 py-3 text-left text-sm font-medium">Role</th>
            <th className="px-4 py-3 text-left text-sm font-medium">Expires</th>
            <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {invitations.map((invitation) => (
            <tr key={invitation.id} className={loadingId === invitation.id ? 'opacity-50' : ''}>
              <td className="px-4 py-3 text-sm">{invitation.email}</td>
              <td className="px-4 py-3">{getRoleBadge(invitation.role)}</td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {invitation.expiresAt
                  ? new Date(invitation.expiresAt).toLocaleDateString()
                  : '-'}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleResend(invitation.id)}
                    disabled={loadingId === invitation.id}
                    title="Resend invitation"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleCancel(invitation.id)}
                    disabled={loadingId === invitation.id}
                    title="Cancel invitation"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
