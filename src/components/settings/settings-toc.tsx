'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'repository', label: 'Repository' },
  { id: 'database', label: 'Database' },
  { id: 'environment', label: 'Environment' },
  { id: 'ai-settings', label: 'AI Settings' },
  { id: 'ai-logs', label: 'AI Logs' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'diff-sensitivity', label: 'Diff Sensitivity' },
  { id: 'playwright', label: 'Playwright' },
  { id: 'team', label: 'Team' },
  { id: 'about', label: 'About' },
];

export function SettingsToC() {
  const [visible, setVisible] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [presentSections, setPresentSections] = useState<string[]>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const scrollContainer = document.getElementById('settings-scroll');
    if (!scrollContainer) return;

    // Detect which section IDs actually exist in the DOM
    const existing = SECTIONS.filter(s => document.getElementById(s.id)).map(s => s.id);
    setPresentSections(existing);

    // Fade in after scrolling 100px
    const handleScroll = () => {
      setVisible(scrollContainer.scrollTop > 100);
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    // IntersectionObserver to track active section
    const visibleEntries = new Map<string, boolean>();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibleEntries.set(entry.target.id, entry.isIntersecting);
        });
        // Pick the first visible section in document order
        for (const s of existing) {
          if (visibleEntries.get(s)) {
            setActiveId(s);
            return;
          }
        }
      },
      {
        root: scrollContainer,
        rootMargin: '-10% 0px -60% 0px',
        threshold: 0,
      }
    );

    existing.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observerRef.current!.observe(el);
    });

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      observerRef.current?.disconnect();
    };
  }, []);

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const filtered = SECTIONS.filter(s => presentSections.includes(s.id));

  return (
    <nav
      className={cn(
        'fixed right-8 top-1/2 -translate-y-1/2 z-50 hidden xl:flex flex-col gap-1 transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
    >
      <div className="bg-background/80 backdrop-blur-sm border rounded-lg p-2 shadow-sm">
        {filtered.map((section) => (
          <button
            key={section.id}
            onClick={() => handleClick(section.id)}
            className={cn(
              'block w-full text-left text-xs px-2.5 py-1 rounded transition-colors',
              activeId === section.id
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
