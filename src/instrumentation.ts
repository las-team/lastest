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

  // Top up the warm EB pool immediately so the first debug/record/test click
  // hits a ready EB without waiting for the cleanup loop in /api/ws/runner
  // (which only starts after an EB polls in — chicken-and-egg if the pool is
  // empty at boot). Requires the global playwright_settings row to exist.
  try {
    const { ensureGlobalPlaywrightSettings } = await import('@/lib/db/queries/settings');
    await ensureGlobalPlaywrightSettings();
    const { isKubernetesMode, ensureWarmPool } = await import('@/lib/eb/provisioner');
    if (isKubernetesMode()) {
      const launched = await ensureWarmPool();
      if (launched > 0) console.log(`[Boot] Warm pool topped up (+${launched}) at startup`);
    }
  } catch (err) {
    console.error('[Boot] ensureWarmPool failed:', err);
  }
}
