'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SECTION_TO_TAB } from '@/components/settings/settings-tabs';

export function SettingsHighlighter() {
  const router = useRouter();

  useEffect(() => {
    const highlight = new URLSearchParams(window.location.search).get('highlight');
    if (!highlight) return;

    const ids = highlight.split(',');
    const firstId = ids[0];

    // Switch to the tab containing the highlighted section, then wait for it
    // to render before scrolling/highlighting.
    const targetTab = firstId ? SECTION_TO_TAB[firstId] : undefined;
    if (targetTab) {
      window.dispatchEvent(
        new CustomEvent('lastest:settings-tab', { detail: { tab: targetTab } })
      );
    }

    let cancelled = false;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let retryRaf: number | null = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // ~500ms at 60fps — covers tab-switch render

    const apply = () => {
      if (cancelled) return;
      const els: HTMLElement[] = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          el.classList.add('settings-highlight');
          els.push(el);
        }
      }

      // The tab containing the target is mounted asynchronously after we
      // dispatch the tab-switch event, so the element may not be in the DOM
      // on the first frame. Retry until found or we hit the cap.
      const target = firstId ? document.getElementById(firstId) : null;
      if (!target && attempts < MAX_ATTEMPTS) {
        attempts++;
        retryRaf = requestAnimationFrame(apply);
        return;
      }
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      cleanupTimer = setTimeout(() => {
        for (const el of els) {
          el.classList.remove('settings-highlight');
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('highlight');
        router.replace(url.pathname + url.search + url.hash, { scroll: false });
      }, 3000);
    };

    retryRaf = requestAnimationFrame(apply);
    return () => {
      cancelled = true;
      if (retryRaf != null) cancelAnimationFrame(retryRaf);
      if (cleanupTimer != null) clearTimeout(cleanupTimer);
    };
  }, [router]);

  return null;
}
