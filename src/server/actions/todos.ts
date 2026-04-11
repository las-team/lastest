'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess } from '@/lib/auth';
import { awardScore } from '@/server/actions/gamification';

export async function getReviewTodos({ repositoryId, branch, buildId }: { repositoryId?: string; branch?: string; buildId?: string }) {
  await requireTeamAccess();

  if (buildId) {
    return queries.getReviewTodosByBuild(buildId);
  }
  if (repositoryId && branch) {
    return queries.getReviewTodosByBranch(repositoryId, branch);
  }
  return [];
}

export async function resolveReviewTodo(todoId: string) {
  const session = await requireTeamAccess();
  const todo = await queries.getReviewTodo(todoId);
  if (!todo) throw new Error('Todo not found');

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
  await requireTeamAccess();
  const todo = await queries.getReviewTodo(todoId);
  if (!todo) throw new Error('Todo not found');

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
  await requireTeamAccess();
  const todo = await queries.getReviewTodo(todoId);
  if (!todo) throw new Error('Todo not found');

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
