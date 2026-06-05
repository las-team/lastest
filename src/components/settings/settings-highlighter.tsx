"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SECTION_TO_TAB } from "@/components/settings/settings-tabs";

export function SettingsHighlighter() {
  const router = useRouter();

  useEffect(() => {
    const highlight = new URLSearchParams(window.location.search).get(
      "highlight",
    );
    if (!highlight) return;

    const ids = highlight.split(",");
    const firstId = ids[0];

    // Switch to the tab containing the highlighted section. SettingsTabs's
    // mount effect also reads `?highlight=` and switches the tab on its own,
    // but the dispatched event covers tab-switching for clients that landed
    // here via in-app `router.push` (no full reload), and matches the contract
    // the tabs component listens on.
    const targetTab = firstId ? SECTION_TO_TAB[firstId] : undefined;
    if (targetTab) {
      // Defer one frame so the SettingsTabs component has run its mount
      // effects and attached its `lastest:settings-tab` listener. Dispatching
      // synchronously inside *this* effect races the listener attach (sibling
      // useEffects fire in render order; the highlighter mounts first), and
      // the event is silently dropped.
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("lastest:settings-tab", {
            detail: { tab: targetTab },
          }),
        );
      });
    }

    let cancelled = false;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const finish = (target: HTMLElement | null, els: HTMLElement[]) => {
      if (cancelled) return;
      if (target) {
        // Two-step scroll: the page-level scroll container (`#settings-scroll`)
        // has its own overflow context, so `scrollIntoView` needs to walk
        // every ancestor. Smooth behavior plus a fallback hash-jump covers
        // browsers (Safari) where smooth-scrolling into a nested overflow
        // container is flaky.
        try {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          target.scrollIntoView();
        }
      }
      // Schedule cleanup after the pulse animation completes. The CSS
      // animation runs 3x (~3s); we clear classes a tick later so the URL
      // param doesn't linger across navigations.
      cleanupTimer = setTimeout(() => {
        for (const el of els) {
          el.classList.remove("settings-highlight");
        }
        const url = new URL(window.location.href);
        if (url.searchParams.has("highlight")) {
          url.searchParams.delete("highlight");
          router.replace(url.pathname + url.search + url.hash, {
            scroll: false,
          });
        }
      }, 3200);
    };

    const tryApply = (): boolean => {
      if (cancelled) return true;
      const target = firstId ? document.getElementById(firstId) : null;
      if (!target) return false;
      const els: HTMLElement[] = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          el.classList.add("settings-highlight");
          els.push(el);
        }
      }
      finish(target, els);
      return true;
    };

    // Fast path: element already in DOM on first paint.
    if (!tryApply()) {
      // Slow path: watch for DOM insertion. Tabs unmount inactive content via
      // Radix Presence, so the target element appears only after the tab
      // switch above commits + repaints. MutationObserver is more reliable
      // than RAF-polling, especially on slower devices where the tab-switch
      // render can take >500ms.
      observer = new MutationObserver(() => {
        if (tryApply()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      // Watchdog so we don't observe forever if the section is genuinely
      // missing (e.g. user lacks permission to see that section's tab).
      watchdog = setTimeout(() => {
        observer?.disconnect();
        observer = null;
        const url = new URL(window.location.href);
        if (url.searchParams.has("highlight")) {
          url.searchParams.delete("highlight");
          router.replace(url.pathname + url.search + url.hash, {
            scroll: false,
          });
        }
      }, 5000);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (cleanupTimer != null) clearTimeout(cleanupTimer);
      if (watchdog != null) clearTimeout(watchdog);
    };
  }, [router]);

  return null;
}
