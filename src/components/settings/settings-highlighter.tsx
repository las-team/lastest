'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export function SettingsHighlighter() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const highlight = searchParams.get('highlight');

  useEffect(() => {
    if (!highlight) return;

    const ids = highlight.split(',');
    const firstId = ids[0];
    const els: HTMLElement[] = [];

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add('settings-highlight');
        els.push(el);
      }
    }

    // Scroll to first highlighted element
    if (firstId) {
      const target = document.getElementById(firstId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    // Remove highlight after animation and clean URL
    const timer = setTimeout(() => {
      for (const el of els) {
        el.classList.remove('settings-highlight');
      }
      // Remove highlight param from URL without navigation
      const url = new URL(window.location.href);
      url.searchParams.delete('highlight');
      router.replace(url.pathname + url.search, { scroll: false });
    }, 3000);

    return () => clearTimeout(timer);
  }, [highlight, router]);

  return null;
}
