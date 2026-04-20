/**
 * Next.js instrumentation hook — runs once when the server boots.
 * Scope: nodejs runtime only (not edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { reconcileOrphanedPoolEBs } = await import('@/server/actions/embedded-sessions');
    await reconcileOrphanedPoolEBs();
  } catch (err) {
    console.error('[Boot] reconcileOrphanedPoolEBs failed:', err);
  }
}
