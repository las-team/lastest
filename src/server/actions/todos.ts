'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { requireBuildOwnership } from '@/lib/auth/ownership';
import { awardScore } from '@/server/actions/gamification';

async function assertTodoOwnership(todoId: string, teamId: string) {
  const todo = await queries.getReviewTodo(todoId);
  if (!todo) throw new Error('Todo not found');
  if (!todo.repositoryId) {
    throw new Error('Forbidden: Todo has no team binding');
  }
  const repo = await queries.getRepository(todo.repositoryId);
  if (!repo || repo.teamId !== teamId) {
    throw new Error('Forbidden: Todo does not belong to your team');
  }
  return todo;
}

export async function getReviewTodos({ repositoryId, branch, buildId }: { repositoryId?: string; branch?: string; buildId?: string }) {
  if (buildId) {
    await requireBuildOwnership(buildId);
    return queries.getReviewTodosByBuild(buildId);
  }
  if (repositoryId && branch) {
    await requireRepoAccess(repositoryId);
    return queries.getReviewTodosByBranch(repositoryId, branch);
  }
  await requireTeamAccess();
  return [];
}

export async function resolveReviewTodo(todoId: string) {
  const session = await requireTeamAccess();
  const todo = await assertTodoOwnership(todoId, session.team.id);

  await queries.updateReviewTodo(todoId, {
    status: 'resolved',
    resolvedBy: session.user?.email || 'user',
    resolvedAt: new Date(),
  });

  // Gamification: small reward to the resolver for clearing a triage item.
  if (session.team) {
    awardScore({
      teamId: session.team.id,
      kind: 'triage_resolved',
      actor: { kind: 'user', id: session.user.id },
      sourceType: 'review_todo',
      sourceId: todoId,
      detail: { diffId: todo.diffId, testId: todo.testId },
    }).catch((err) => console.error('[gamification] triage_resolved failed', err));
  }

  revalidatePath('/review');
  revalidatePath('/builds');

  return { success: true };
}

export async function reopenReviewTodo(todoId: string) {
  const session = await requireTeamAccess();
  await assertTodoOwnership(todoId, session.team.id);

  await queries.updateReviewTodo(todoId, {
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
  });

  revalidatePath('/review');
  revalidatePath('/builds');

  return { success: true };
}

export async function deleteReviewTodoAction(todoId: string) {
  const session = await requireTeamAccess();
  const todo = await assertTodoOwnership(todoId, session.team.id);

  await queries.deleteReviewTodo(todoId);

  // If diff was in 'todo' status, revert to 'pending'
  if (todo.diffId) {
    const diff = await queries.getVisualDiff(todo.diffId);
    if (diff && diff.status === 'todo') {
      await queries.updateVisualDiff(todo.diffId, { status: 'pending' });
      if (diff.buildId) {
        const newStatus = await queries.computeBuildStatus(diff.buildId);
        await queries.updateBuild(diff.buildId, { overallStatus: newStatus });
      }
    }
  }

  revalidatePath('/review');
  revalidatePath('/builds');

  return { success: true };
}
