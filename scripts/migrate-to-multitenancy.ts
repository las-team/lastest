/**
 * Multi-tenancy Migration Script
 *
 * This script migrates existing data to the multi-tenancy model by:
 * 1. Creating a "Default" team for existing data
 * 2. Setting teamId on all existing repositories
 * 3. Setting teamId on all existing users (first admin becomes owner)
 * 4. Setting teamId on existing GitHub account
 * 5. Setting teamId on existing invitations
 *
 * Run with: npx tsx scripts/migrate-to-multitenancy.ts
 */

import { db } from '../src/lib/db';
import { teams, users, repositories, githubAccounts, userInvitations } from '../src/lib/db/schema';
import { eq, isNull } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

async function migrate() {
  console.log('Starting multi-tenancy migration...\n');

  // Check if migration has already been run
  const existingTeams = await db.select().from(teams).all();
  if (existingTeams.length > 0) {
    console.log('Migration has already been run. Skipping.');
    return;
  }

  // Get all existing users
  const allUsers = await db.select().from(users).all();
  if (allUsers.length === 0) {
    console.log('No existing users found. Migration not needed.');
    return;
  }

  // Create the Default team
  const teamId = uuid();
  const now = new Date();
  await db.insert(teams).values({
    id: teamId,
    name: 'Default Team',
    slug: 'default',
    createdAt: now,
    updatedAt: now,
  });
  console.log(`✓ Created "Default Team" with ID: ${teamId}`);

  // Find the first admin user to make them owner
  const firstAdmin = allUsers.find(u => u.role === 'admin') || allUsers[0];

  // Update all users with teamId
  for (const user of allUsers) {
    const newRole = user.id === firstAdmin.id ? 'owner' : user.role;
    await db.update(users).set({ teamId, role: newRole }).where(eq(users.id, user.id));
  }
  console.log(`✓ Updated ${allUsers.length} users with teamId`);
  console.log(`  - ${firstAdmin.email} is now the team owner`);

  // Update all repositories with teamId
  const allRepos = await db.select().from(repositories).where(isNull(repositories.teamId)).all();
  for (const repo of allRepos) {
    await db.update(repositories).set({ teamId }).where(eq(repositories.id, repo.id));
  }
  console.log(`✓ Updated ${allRepos.length} repositories with teamId`);

  // Update GitHub account with teamId
  const allGithubAccounts = await db.select().from(githubAccounts).where(isNull(githubAccounts.teamId)).all();
  for (const account of allGithubAccounts) {
    await db.update(githubAccounts).set({ teamId }).where(eq(githubAccounts.id, account.id));
  }
  console.log(`✓ Updated ${allGithubAccounts.length} GitHub accounts with teamId`);

  // Update pending invitations with teamId
  const pendingInvitations = await db.select().from(userInvitations).where(isNull(userInvitations.teamId)).all();
  for (const invitation of pendingInvitations) {
    await db.update(userInvitations).set({ teamId }).where(eq(userInvitations.id, invitation.id));
  }
  console.log(`✓ Updated ${pendingInvitations.length} pending invitations with teamId`);

  console.log('\n✓ Migration completed successfully!');
}

migrate().catch(console.error);
