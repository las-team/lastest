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

    const apply = () => {
      const els: HTMLElement[] = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          el.classList.add('settings-highlight');
          els.push(el);
        }
      }

      if (firstId) {
        const target = document.getElementById(firstId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      const timer = setTimeout(() => {
        for (const el of els) {
          el.classList.remove('settings-highlight');
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('highlight');
        router.replace(url.pathname + url.search + url.hash, { scroll: false });
      }, 3000);

      return () => clearTimeout(timer);
    };

    // Defer one frame so the new tab's content is mounted before we look up ids.
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [router]);

  return null;
}
