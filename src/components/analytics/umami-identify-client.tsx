"use client";

import { useEffect } from "react";
import { identify } from "@/lib/analytics/umami";

interface UmamiIdentifyClientProps {
  userId: string;
  teamId: string | null;
}

export function UmamiIdentifyClient({ userId, teamId }: UmamiIdentifyClientProps) {
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 20;

    const send = () => {
      if (cancelled) return;
      if (typeof window === "undefined") return;
      if (window.umami) {
        identify(userId, teamId ? { teamId } : undefined);
        return;
      }
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) return;
      setTimeout(send, 250);
    };

    send();

    return () => {
      cancelled = true;
    };
  }, [userId, teamId]);

  return null;
}
