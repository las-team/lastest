import { redirect } from 'next/navigation';
import { requireTeamAdmin } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { UserList } from '@/components/users/user-list';
import { PendingInvitations } from '@/components/users/pending-invitations';
import { InviteUserDialog } from '@/components/users/invite-user-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Mail } from 'lucide-react';

export default async function UsersPage() {
  let session;
  try {
    session = await requireTeamAdmin();
  } catch {
    redirect('/');
  }

  const [users, pendingInvitations] = await Promise.all([
    queries.getTeamMembers(session.team.id),
    queries.getPendingInvitationsByTeam(session.team.id),
  ]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Team Members</h1>
              <p className="text-muted-foreground text-sm">
                Manage members of {session.team.name}
              </p>
            </div>
            <InviteUserDialog />
          </div>

          {/* Pending Invitations */}
          {pendingInvitations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  Pending Invitations
                </CardTitle>
                <CardDescription>
                  Invitations awaiting acceptance
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PendingInvitations invitations={pendingInvitations} />
              </CardContent>
            </Card>
          )}

          {/* Users */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Members ({users.length})
              </CardTitle>
              <CardDescription>
                All members of this team
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UserList users={users} currentUserId={session.user.id} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
